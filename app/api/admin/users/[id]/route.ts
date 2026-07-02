import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { adminAuth } from '@/lib/firebase/admin'
import type { Role } from '@/types'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile: adminProfile, error } = await requireAdmin(req)
  if (error) return error

  const { id } = await params

  let body: {
    full_name?: string
    role?: Role
    team_id?: string | null
    is_active?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Fetch current state (need firebase_uid for potential disable)
  const existing = await withUser(adminProfile.id, async (tx) => {
    const rows = await tx<{ firebase_uid: string; is_active: boolean; role: Role }[]>`
      SELECT firebase_uid, is_active, role FROM profiles WHERE id = ${id} LIMIT 1
    `
    return rows[0] ?? null
  })

  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Build update object — only include provided fields
  const updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) updates.full_name = body.full_name.trim()
  if (body.role !== undefined) updates.role = body.role
  if ('team_id' in body) updates.team_id = body.team_id ?? null
  if (body.is_active !== undefined) updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  await withUser(adminProfile.id, async (tx) => {
    await tx`UPDATE profiles SET ${tx(updates)} WHERE id = ${id}`

    // Keep teams.subadmin_id in sync when assigning a team leader to a team —
    // team_leader, subadmin, and admin are all automatically team leaders (§3).
    const newRole = body.role ?? existing.role
    const newTeamId = 'team_id' in body ? (body.team_id ?? null) : null
    if (['team_leader', 'subadmin', 'admin'].includes(newRole) && newTeamId) {
      await tx`UPDATE teams SET subadmin_id = ${id} WHERE id = ${newTeamId}`
    }
  })

  // Disable Firebase account if deactivating
  if (body.is_active === false && existing.is_active) {
    await adminAuth.updateUser(existing.firebase_uid, { disabled: true }).catch((e) =>
      console.error('[admin/users PATCH] Firebase disable failed:', e)
    )
  }
  // Re-enable Firebase account if reactivating
  if (body.is_active === true && !existing.is_active) {
    await adminAuth.updateUser(existing.firebase_uid, { disabled: false }).catch((e) =>
      console.error('[admin/users PATCH] Firebase enable failed:', e)
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile: adminProfile, error } = await requireAdmin(req)
  if (error) return error

  const { id } = await params

  if (id === adminProfile.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  // Resolve the Firebase UID before the row is gone.
  const existing = await withUser(adminProfile.id, async (tx) => {
    const rows = await tx<{ firebase_uid: string }[]>`
      SELECT firebase_uid FROM profiles WHERE id = ${id} LIMIT 1
    `
    return rows[0] ?? null
  })

  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Delete the profile row. leads.assigned_agent_id / assigned_by and
  // teams.subadmin_id are ON DELETE SET NULL, but activities.user_id is
  // ON DELETE RESTRICT — a user who has logged any activity cannot be hard
  // deleted (we preserve lead history). Catch that FK violation (23503) and
  // tell the admin to deactivate instead.
  try {
    await withUser(adminProfile.id, async (tx) => {
      await tx`DELETE FROM profiles WHERE id = ${id}`
    })
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === '23503') {
      return NextResponse.json(
        {
          error:
            'This user has activity history and cannot be deleted. Deactivate them instead to preserve lead records.',
        },
        { status: 409 }
      )
    }
    console.error('[admin/users DELETE] DB delete failed:', err)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }

  // Remove the Firebase account (non-fatal — the profile is already gone, which
  // is what the app reads; a leftover Firebase user simply can't sign in to any
  // profile).
  await adminAuth.deleteUser(existing.firebase_uid).catch((e) =>
    console.error('[admin/users DELETE] Firebase delete failed:', e)
  )

  return NextResponse.json({ ok: true })
}

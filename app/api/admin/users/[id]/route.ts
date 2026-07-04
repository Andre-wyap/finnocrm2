import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { adminAuth } from '@/lib/firebase/admin'
import { isUuid } from '@/lib/validation'
import type { Role } from '@/types'

const VALID_ROLES = new Set<Role>(['agent', 'team_leader', 'subadmin', 'admin'])
const TEAM_LEADER_ROLES = new Set<Role>(['team_leader', 'subadmin', 'admin'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile: adminProfile, error } = await requireAdmin(req)
  if (error) return error

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  let body: {
    full_name?: string
    role?: Role
    team_id?: string | null
    is_active?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const normalizedFullName = body.full_name !== undefined ? body.full_name.trim() : undefined
  if (normalizedFullName !== undefined && !normalizedFullName) {
    return NextResponse.json({ error: 'full_name cannot be empty' }, { status: 422 })
  }
  if (body.role !== undefined && !VALID_ROLES.has(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 422 })
  }
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 422 })
  }

  const hasTeamId = 'team_id' in body
  if (hasTeamId && body.team_id !== null && body.team_id !== undefined && typeof body.team_id !== 'string') {
    return NextResponse.json({ error: 'team_id must be a UUID or null' }, { status: 422 })
  }
  const normalizedTeamId = hasTeamId
    ? typeof body.team_id === 'string' && body.team_id.trim() !== ''
      ? body.team_id.trim()
      : null
    : undefined
  if (normalizedTeamId !== undefined && normalizedTeamId !== null && !isUuid(normalizedTeamId)) {
    return NextResponse.json({ error: 'Invalid team_id' }, { status: 422 })
  }

  // Fetch current state (need firebase_uid for potential disable)
  const existing = await withUser(adminProfile.id, async (tx) => {
    const rows = await tx<{ firebase_uid: string; is_active: boolean; role: Role; team_id: string | null }[]>`
      SELECT firebase_uid, is_active, role, team_id FROM profiles WHERE id = ${id}::uuid LIMIT 1
    `
    return rows[0] ?? null
  })

  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (normalizedTeamId) {
    const [team] = await withUser(adminProfile.id, (tx) =>
      tx<{ id: string }[]>`SELECT id FROM teams WHERE id = ${normalizedTeamId}::uuid LIMIT 1`
    )
    if (!team) return NextResponse.json({ error: 'team_id does not exist' }, { status: 422 })
  }

  // Build update object — only include provided fields
  const updates: Record<string, unknown> = {}
  if (normalizedFullName !== undefined) updates.full_name = normalizedFullName
  if (body.role !== undefined) updates.role = body.role
  if (hasTeamId) updates.team_id = normalizedTeamId ?? null
  if (body.is_active !== undefined) updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  await withUser(adminProfile.id, async (tx) => {
    await tx`UPDATE profiles SET ${tx(updates)} WHERE id = ${id}::uuid`

    // Keep teams.subadmin_id in sync when a team leader is assigned, moved,
    // demoted, or deactivated.
    const newRole = body.role ?? existing.role
    const newTeamId = hasTeamId ? (normalizedTeamId ?? null) : existing.team_id
    const newIsActive = body.is_active ?? existing.is_active

    if (!newIsActive || !TEAM_LEADER_ROLES.has(newRole) || !newTeamId) {
      await tx`UPDATE teams SET subadmin_id = NULL WHERE subadmin_id = ${id}::uuid`
    } else {
      await tx`UPDATE teams SET subadmin_id = NULL WHERE subadmin_id = ${id}::uuid AND id <> ${newTeamId}::uuid`
      await tx`UPDATE teams SET subadmin_id = ${id}::uuid WHERE id = ${newTeamId}::uuid`
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
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  if (id === adminProfile.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  // Resolve the Firebase UID before the row is gone.
  const existing = await withUser(adminProfile.id, async (tx) => {
    const rows = await tx<{ firebase_uid: string }[]>`
      SELECT firebase_uid FROM profiles WHERE id = ${id}::uuid LIMIT 1
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
      await tx`DELETE FROM profiles WHERE id = ${id}::uuid`
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

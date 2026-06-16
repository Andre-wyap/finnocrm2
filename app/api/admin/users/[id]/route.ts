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

    // Keep teams.subadmin_id in sync when assigning a subadmin to a team
    const newRole = body.role ?? existing.role
    const newTeamId = 'team_id' in body ? (body.team_id ?? null) : null
    if (newRole === 'subadmin' && newTeamId) {
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

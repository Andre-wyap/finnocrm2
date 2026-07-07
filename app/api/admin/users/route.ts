import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { adminAuth } from '@/lib/firebase/admin'
import { createInviteLink, getInviteExpiryHours } from '@/lib/invites'
import { isUuid } from '@/lib/validation'
import type { Role } from '@/types'

const VALID_ROLES = new Set<Role>(['agent', 'team_leader', 'subadmin', 'admin'])
const TEAM_LEADER_ROLES = new Set<Role>(['team_leader', 'subadmin', 'admin'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const rows = await withUser(profile.id, (tx) =>
    tx<{
      id: string
      full_name: string
      email: string
      phone: string | null
      role: Role
      team_id: string | null
      team_name: string | null
      is_active: boolean
      created_at: string
    }[]>`
      SELECT p.id, p.full_name, p.email, p.phone, p.role,
             p.team_id, t.name AS team_name, p.is_active, p.created_at
      FROM profiles p
      LEFT JOIN teams t ON t.id = p.team_id
      ORDER BY p.created_at
    `
  )

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile: adminProfile, error } = await requireAdmin(req)
  if (error) return error

  let body: { full_name?: string; email?: string; role?: Role; team_id?: string | null }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const full_name = body.full_name?.trim() ?? ''
  const email = body.email?.trim() ?? ''
  const role = body.role
  if (body.team_id !== null && body.team_id !== undefined && typeof body.team_id !== 'string') {
    return NextResponse.json({ error: 'team_id must be a UUID or null' }, { status: 422 })
  }
  const teamId = typeof body.team_id === 'string' && body.team_id.trim() !== ''
    ? body.team_id.trim()
    : null

  if (!full_name || !email || !role) {
    return NextResponse.json({ error: 'full_name, email, and role are required' }, { status: 422 })
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 422 })
  }
  if (teamId && !isUuid(teamId)) {
    return NextResponse.json({ error: 'Invalid team_id' }, { status: 422 })
  }

  if (teamId) {
    const [team] = await withUser(adminProfile.id, (tx) =>
      tx<{ id: string }[]>`SELECT id FROM teams WHERE id = ${teamId}::uuid LIMIT 1`
    )
    if (!team) return NextResponse.json({ error: 'team_id does not exist' }, { status: 422 })
  }

  // 1. Create Firebase Auth user
  let firebaseUid: string
  try {
    const fbUser = await adminAuth.createUser({ email, displayName: full_name })
    firebaseUid = fbUser.uid
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === 'auth/email-already-exists') {
      return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
    }
    console.error('[admin/users POST] Firebase createUser failed:', err)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }

  // 2. Insert profile + optionally assign subadmin to team (atomic)
  let profileId: string
  try {
    profileId = await withUser(adminProfile.id, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
        VALUES (${firebaseUid}, ${full_name}, ${email}, ${role}, ${teamId}::uuid)
        RETURNING id
      `
      // team_leader, subadmin, and admin are all automatically team leaders (§3) —
      // any of the three can be designated a team's leader by picking a team here.
      if (TEAM_LEADER_ROLES.has(role) && teamId) {
        await tx`UPDATE teams SET subadmin_id = ${row.id}::uuid WHERE id = ${teamId}::uuid`
      }
      return row.id
    })
  } catch (err) {
    console.error('[admin/users POST] DB insert failed — cleaning up Firebase user:', err)
    await adminAuth.deleteUser(firebaseUid).catch((e) =>
      console.error('[admin/users POST] Firebase cleanup failed:', e)
    )
    return NextResponse.json({ error: 'Failed to create user profile' }, { status: 500 })
  }

  // 3. Generate password-setup link (non-fatal if it fails)
  let inviteLink: string | null = null
  try {
    inviteLink = createInviteLink(req.nextUrl.origin, firebaseUid, email)
  } catch (err) {
    console.error('[admin/users POST] Failed to generate invite link:', err)
  }

  return NextResponse.json({ id: profileId, inviteLink, expiresInHours: getInviteExpiryHours() }, { status: 201 })
}

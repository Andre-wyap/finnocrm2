import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db/client'
import { adminAuth } from '@/lib/firebase/admin'
import { verifyInviteToken } from '@/lib/invites'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { token?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = body.token?.trim() ?? ''
  const password = body.password ?? ''

  if (!token) {
    return NextResponse.json({ error: 'Invite token is required' }, { status: 422 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 422 })
  }

  let invite
  try {
    invite = verifyInviteToken(token)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const [profile] = await sql<{ email: string }[]>`
    SELECT email
    FROM get_profile_by_firebase_uid(${invite.uid})
    LIMIT 1
  `

  if (!profile || profile.email !== invite.email) {
    return NextResponse.json({ error: 'Invite link is no longer valid.' }, { status: 400 })
  }

  try {
    await adminAuth.updateUser(invite.uid, {
      password,
      disabled: false,
      emailVerified: true,
    })
  } catch (err) {
    console.error('[invite/accept] Firebase password setup failed:', err)
    return NextResponse.json({ error: 'Failed to set password. Please ask an admin to resend the invite.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email: invite.email })
}

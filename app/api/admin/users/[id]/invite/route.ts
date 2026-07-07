import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { createInviteLink, getInviteExpiryHours } from '@/lib/invites'
import { isUuid } from '@/lib/validation'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile: adminProfile, error } = await requireAdmin(req)
  if (error) return error

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const existing = await withUser(adminProfile.id, async (tx) => {
    const rows = await tx<{ firebase_uid: string; email: string; is_active: boolean }[]>`
      SELECT firebase_uid, email, is_active
      FROM profiles
      WHERE id = ${id}::uuid
      LIMIT 1
    `
    return rows[0] ?? null
  })

  if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!existing.is_active) {
    return NextResponse.json({ error: 'Reactivate this user before resending an invite.' }, { status: 409 })
  }

  return NextResponse.json({
    inviteLink: createInviteLink(req.nextUrl.origin, existing.firebase_uid, existing.email),
    expiresInHours: getInviteExpiryHours(),
  })
}

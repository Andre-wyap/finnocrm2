import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const data = await withUser(profile.id, async (tx) => {
    const [row] = await tx<{ full_name: string; email: string; phone: string | null }[]>`
      SELECT full_name, email, phone
      FROM profiles
      WHERE id = current_user_id()
      LIMIT 1
    `
    return row
  })

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const body = await req.json()
  const { full_name, phone, email } = body as { full_name?: string; phone?: string; email?: string }

  if (!full_name && phone === undefined && email === undefined) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  await withUser(profile.id, async (tx) => {
    await tx`
      UPDATE profiles
      SET
        full_name  = COALESCE(${full_name ?? null},  full_name),
        phone      = COALESCE(${phone    ?? null},  phone),
        email      = COALESCE(${email    ?? null},  email)
      WHERE id = current_user_id()
    `
  })

  return NextResponse.json({ ok: true })
}

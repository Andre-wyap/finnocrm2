import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Profiles RLS scopes this: subadmin sees own team, admin sees all
  const agents = await withUser(profile.id, (tx) =>
    tx<{ id: string; full_name: string; team_id: string | null; team_name: string | null }[]>`
      SELECT p.id, p.full_name, p.team_id, t.name AS team_name
      FROM profiles p
      LEFT JOIN teams t ON t.id = p.team_id
      WHERE p.role = 'agent' AND p.is_active = true
      ORDER BY p.full_name
    `
  )

  return NextResponse.json(agents)
}

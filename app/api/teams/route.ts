import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

// Lightweight team list for the Leads-page team filter (subadmin/admin only —
// a team_leader's view is already locked to their own team, so they don't
// need this). Mirrors /api/agents: a non-admin-prefixed read endpoint that
// just trusts RLS (teams_select already grants subadmin/admin every team).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role !== 'admin' && profile.role !== 'subadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await withUser(profile.id, (tx) =>
    tx<{ id: string; name: string }[]>`SELECT id, name FROM teams ORDER BY name`
  )

  return NextResponse.json(rows)
}

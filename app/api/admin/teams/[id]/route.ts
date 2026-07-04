import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

type TeamDeleteSummary = {
  id: string
  name: string
  member_count: number
  lead_count: number
  source_count: number
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const { id } = await params

  const [team] = await withUser(profile.id, (tx) =>
    tx<TeamDeleteSummary[]>`
      SELECT t.id, t.name,
             COUNT(DISTINCT p.id)::int  AS member_count,
             COUNT(DISTINCT l.id)::int  AS lead_count,
             COUNT(DISTINCT ts.id)::int AS source_count
      FROM teams t
      LEFT JOIN profiles p ON p.team_id = t.id
      LEFT JOIN leads l ON l.team_id = t.id
      LEFT JOIN team_sources ts ON ts.team_id = t.id
      WHERE t.id = ${id}::uuid
      GROUP BY t.id, t.name
      LIMIT 1
    `
  )

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  await withUser(profile.id, (tx) =>
    tx`DELETE FROM teams WHERE id = ${id}::uuid`
  )

  return NextResponse.json({ ok: true, team })
}

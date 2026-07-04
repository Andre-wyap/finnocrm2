import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'

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
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid team id' }, { status: 400 })
  }

  const [team] = await withUser(profile.id, (tx) =>
    tx<TeamDeleteSummary[]>`
      SELECT t.id, t.name,
             COALESCE(members.member_count, 0)::int AS member_count,
             COALESCE(leads.lead_count, 0)::int AS lead_count,
             COALESCE(sources.source_count, 0)::int AS source_count
      FROM teams t
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS member_count
        FROM profiles p
        WHERE p.team_id = t.id
      ) members ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS lead_count
        FROM leads l
        WHERE l.team_id = t.id
      ) leads ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS source_count
        FROM team_sources ts
        WHERE ts.team_id = t.id
      ) sources ON true
      WHERE t.id = ${id}::uuid
      LIMIT 1
    `
  )

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  await withUser(profile.id, (tx) =>
    tx`DELETE FROM teams WHERE id = ${id}::uuid`
  )

  return NextResponse.json({ ok: true, team })
}

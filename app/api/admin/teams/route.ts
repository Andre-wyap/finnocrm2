import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { TeamSource } from '@/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const rows = await withUser(profile.id, (tx) =>
    tx<{
      id: string
      name: string
      subadmin_id: string | null
      subadmin_name: string | null
      agent_count: number
      member_count: number
      lead_count: number
      source_count: number
      sources: TeamSource[]
      created_at: string
    }[]>`
      SELECT t.id, t.name, t.created_at,
             sp.id   AS subadmin_id,
             sp.full_name AS subadmin_name,
             COALESCE(members.agent_count, 0)::int AS agent_count,
             COALESCE(members.member_count, 0)::int AS member_count,
             COALESCE(leads.lead_count, 0)::int AS lead_count,
             COALESCE(sources.source_count, 0)::int AS source_count,
             COALESCE(sources.items, '[]'::json) AS sources
      FROM teams t
      LEFT JOIN profiles sp ON sp.id = t.subadmin_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS member_count,
          COUNT(*) FILTER (WHERE role = 'agent' AND is_active = true)::int AS agent_count
        FROM profiles p
        WHERE p.team_id = t.id
      ) members ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS lead_count
        FROM leads l
        WHERE l.team_id = t.id
      ) leads ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS source_count,
          COALESCE(
            json_agg(
              json_build_object(
                'id', ts.id,
                'team_id', ts.team_id,
                'source', ts.source,
                'created_at', ts.created_at
              )
              ORDER BY ts.source
            ),
            '[]'::json
          ) AS items
        FROM team_sources ts
        WHERE ts.team_id = t.id
      ) sources ON true
      ORDER BY t.name
    `
  )

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  let body: { name?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = body.name?.trim() ?? ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 422 })

  const [row] = await withUser(profile.id, (tx) =>
    tx<{ id: string; name: string }[]>`
      INSERT INTO teams (name) VALUES (${name}) RETURNING id, name
    `
  )

  return NextResponse.json(row, { status: 201 })
}

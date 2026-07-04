import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

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
      created_at: string
    }[]>`
      SELECT t.id, t.name, t.created_at,
             sp.id   AS subadmin_id,
             sp.full_name AS subadmin_name,
             COUNT(DISTINCT a.id)::int  AS agent_count,
             COUNT(DISTINCT m.id)::int  AS member_count,
             COUNT(DISTINCT l.id)::int  AS lead_count,
             COUNT(DISTINCT ts.id)::int AS source_count
      FROM teams t
      LEFT JOIN profiles sp ON sp.id = t.subadmin_id
      LEFT JOIN profiles a  ON a.team_id = t.id AND a.role = 'agent' AND a.is_active = true
      LEFT JOIN profiles m  ON m.team_id = t.id
      LEFT JOIN leads l     ON l.team_id = t.id
      LEFT JOIN team_sources ts ON ts.team_id = t.id
      GROUP BY t.id, t.name, t.created_at, sp.id, sp.full_name
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

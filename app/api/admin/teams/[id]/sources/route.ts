import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { TeamSource } from '@/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const { id: teamId } = await params

  const rows = await withUser(profile.id, (tx) =>
    tx<TeamSource[]>`
      SELECT id, team_id, source, created_at
      FROM team_sources
      WHERE team_id = ${teamId}::uuid
      ORDER BY source
    `
  )

  return NextResponse.json(rows)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const { id: teamId } = await params

  let body: { source?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const source = body.source?.trim() ?? ''
  if (!source) return NextResponse.json({ error: 'source is required' }, { status: 422 })

  try {
    const [row] = await withUser(profile.id, (tx) =>
      tx<TeamSource[]>`
        INSERT INTO team_sources (team_id, source)
        VALUES (${teamId}::uuid, ${source})
        RETURNING id, team_id, source, created_at
      `
    )
    return NextResponse.json(row, { status: 201 })
  } catch (err: unknown) {
    // source is UNIQUE — one source belongs to exactly one team (§8)
    if ((err as { code?: string })?.code === '23505') {
      return NextResponse.json(
        { error: 'This source is already mapped to a team.' },
        { status: 409 }
      )
    }
    console.error('[admin/teams/[id]/sources POST] insert failed:', err)
    return NextResponse.json({ error: 'Failed to add source' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const { id: teamId } = await params

  let body: { source_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sourceId = body.source_id
  if (!sourceId) return NextResponse.json({ error: 'source_id is required' }, { status: 422 })

  await withUser(profile.id, (tx) =>
    tx`DELETE FROM team_sources WHERE id = ${sourceId}::uuid AND team_id = ${teamId}::uuid`
  )

  return NextResponse.json({ ok: true })
}

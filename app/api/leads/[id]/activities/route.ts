import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { ActivityType } from '@/types'

type ActivityRow = {
  id: string
  type: ActivityType
  content: string | null
  field_name: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
  actor_name: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const { id } = await params

  const activities = await withUser(profile.id, (tx) =>
    tx<ActivityRow[]>`
      SELECT a.id, a.type, a.content, a.field_name, a.old_value, a.new_value,
             a.created_at,
             p.full_name AS actor_name
      FROM activities a
      LEFT JOIN profiles p ON p.id = a.user_id
      WHERE a.lead_id = ${id}::uuid
      ORDER BY a.created_at DESC
    `
  )

  return NextResponse.json(activities)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const { id } = await params

  let body: { content?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const content = body.content?.trim() ?? ''
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 422 })

  // Verify lead is accessible; RLS scopes this automatically
  const [lead] = await withUser(profile.id, (tx) =>
    tx<{ id: string }[]>`SELECT id FROM leads WHERE id = ${id}::uuid LIMIT 1`
  )
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await withUser(profile.id, (tx) =>
    tx`
      INSERT INTO activities (lead_id, user_id, type, content)
      VALUES (${id}::uuid, ${profile.id}::uuid, 'remark', ${content})
    `
  )

  return NextResponse.json({ ok: true }, { status: 201 })
}

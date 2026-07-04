import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
  }

  let body: { agent_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const targetId = body.agent_id?.trim()
  if (!targetId) return NextResponse.json({ error: 'agent_id is required' }, { status: 422 })
  if (!isUuid(targetId)) return NextResponse.json({ error: 'Invalid agent_id' }, { status: 422 })

  // Look up the target user via get_assignable_users() — SECURITY DEFINER, so
  // subadmins are not limited to their own team. Any active user is a valid target.
  const [target] = await withUser(profile.id, (tx) =>
    tx<{ id: string; full_name: string; team_id: string | null }[]>`
      SELECT id, full_name, team_id FROM get_assignable_users()
      WHERE id = ${targetId}::uuid
      LIMIT 1
    `
  )

  if (!target) return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 })

  const activityContent = `${profile.full_name} assigned this lead to ${target.full_name}`

  const updated = await withUser(profile.id, async (tx) => {
    const [current] = await tx<{ assigned_agent_id: string | null }[]>`
      SELECT assigned_agent_id FROM leads WHERE id = ${id}::uuid LIMIT 1
    `
    if (!current) return []

    const isReassignment = current.assigned_agent_id !== null
    const content = isReassignment
      ? `${profile.full_name} reassigned this lead to ${target.full_name}`
      : activityContent

    // team_id follows the assignee's team — a no-op for in-team assignment,
    // and how a subadmin/admin moves a lead's owning team across teams (§9).
    // source is untouched.
    const rows = await tx<{ id: string }[]>`
      UPDATE leads
      SET assigned_agent_id = ${targetId}::uuid,
          assigned_by       = ${profile.id}::uuid,
          assigned_at       = now(),
          team_id           = ${target.team_id}::uuid,
          status = CASE WHEN status = 'unassigned' THEN 'lead'::lead_status ELSE status END
      WHERE id = ${id}::uuid
      RETURNING id
    `
    if (rows.length > 0) {
      await tx`
        INSERT INTO activities (lead_id, user_id, type, content)
        VALUES (${id}::uuid, ${profile.id}::uuid, 'assignment', ${content})
      `
    }
    return rows
  })

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Lead not found or not accessible' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

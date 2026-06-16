import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

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

  let body: { agent_id?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agentId = body.agent_id?.trim()
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 422 })

  // Look up agent — profiles RLS limits subadmin to own team automatically
  const [agent] = await withUser(profile.id, (tx) =>
    tx<{ id: string; full_name: string; team_id: string | null }[]>`
      SELECT id, full_name, team_id FROM profiles
      WHERE id = ${agentId}::uuid AND role = 'agent' AND is_active = true
      LIMIT 1
    `
  )

  if (!agent) return NextResponse.json({ error: 'Agent not found or not in scope' }, { status: 404 })

  // Belt-and-suspenders: subadmin can only assign to own team
  if (profile.role === 'subadmin' && agent.team_id !== profile.team_id) {
    return NextResponse.json({ error: 'Agent is not in your team' }, { status: 403 })
  }

  const updated = await withUser(profile.id, async (tx) => {
    // Read current state so we know if this is an initial assignment or a reassignment
    const [current] = await tx<{ assigned_agent_id: string | null }[]>`
      SELECT assigned_agent_id FROM leads WHERE id = ${id}::uuid LIMIT 1
    `
    if (!current) return []

    const isReassignment = current.assigned_agent_id !== null
    const activityContent = isReassignment
      ? `Reassigned to ${agent.full_name}`
      : `Assigned to ${agent.full_name}`

    const rows = await tx<{ id: string }[]>`
      UPDATE leads
      SET assigned_agent_id = ${agentId}::uuid,
          assigned_by       = ${profile.id}::uuid,
          assigned_at       = now(),
          -- Only promote to 'lead' on first assignment; reassignment keeps the current stage
          status = CASE WHEN status = 'unassigned' THEN 'lead'::lead_status ELSE status END
      WHERE id = ${id}::uuid
      RETURNING id
    `
    if (rows.length > 0) {
      await tx`
        INSERT INTO activities (lead_id, user_id, type, content)
        VALUES (${id}::uuid, ${profile.id}::uuid, 'assignment', ${activityContent})
      `
    }
    return rows
  })

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Lead not found or not accessible' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

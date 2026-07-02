import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { lead_ids?: unknown; agent_id?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lead_ids, agent_id } = body

  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ error: 'lead_ids must be a non-empty array' }, { status: 422 })
  }
  if (typeof agent_id !== 'string' || !agent_id) {
    return NextResponse.json({ error: 'agent_id is required' }, { status: 422 })
  }

  const leadIds = lead_ids as string[]

  // Validate target user via SECURITY DEFINER (bypasses profile SELECT RLS)
  const [target] = await withUser(profile.id, (tx) =>
    tx<{ id: string; full_name: string; team_id: string | null }[]>`
      SELECT id, full_name, team_id FROM get_assignable_users() WHERE id = ${agent_id}::uuid LIMIT 1
    `
  )
  if (!target) return NextResponse.json({ error: 'Invalid agent_id' }, { status: 422 })

  const contentAssigned   = `${profile.full_name} assigned this lead to ${target.full_name}`
  const contentReassigned = `${profile.full_name} reassigned this lead to ${target.full_name}`

  try {
    const assigned = await withUser(profile.id, async (tx) => {
      // Capture old statuses BEFORE the update so we can pick the right activity text.
      // CTE reads happen at statement start so `before` sees pre-update values.
      const [{ assigned_count }] = await tx<{ assigned_count: number }[]>`
        WITH before AS (
          SELECT id, status AS old_status
          FROM   leads
          WHERE  id = ANY(${leadIds}::uuid[])
        ),
        updated AS (
          -- team_id follows the assignee's team for every lead in the batch
          -- (no-op in-team, or how a subadmin/admin moves ownership across
          -- teams — §9). source is untouched.
          UPDATE leads
          SET    assigned_agent_id = ${agent_id}::uuid,
                 status            = CASE WHEN status = 'unassigned'
                                          THEN 'lead'::lead_status
                                          ELSE status
                                     END,
                 assigned_by       = ${profile.id}::uuid,
                 assigned_at       = NOW(),
                 team_id           = ${target.team_id}::uuid
          WHERE  id = ANY(${leadIds}::uuid[])
          RETURNING id
        ),
        ins AS (
          INSERT INTO activities (lead_id, user_id, type, content)
          SELECT u.id,
                 ${profile.id}::uuid,
                 'assignment',
                 CASE WHEN b.old_status = 'unassigned'
                      THEN ${contentAssigned}
                      ELSE ${contentReassigned}
                 END
          FROM   updated u
          JOIN   before  b ON b.id = u.id
        )
        SELECT COUNT(*)::int AS assigned_count FROM updated
      `
      return assigned_count
    })

    return NextResponse.json({ assigned, skipped: leadIds.length - assigned })
  } catch {
    return NextResponse.json({ error: 'Bulk assign failed' }, { status: 500 })
  }
}

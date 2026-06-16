import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

type PipelineCounts = { lead: number; potential: number; closed: number; issued: number; lost: number }

type AgentBreakdown = {
  agent_id: string
  agent_name: string
  total_count: number
  lead_count: number
  potential_count: number
  closed_count: number
  issued_count: number
  case_size: number
}

type TeamBreakdown = {
  team_id: string | null
  team_name: string | null
  total_count: number
  case_size: number
}

type SourceBreakdown = {
  source: string
  total_count: number
  case_size: number
}

export type DashboardData = {
  new_leads_today: number
  follow_ups_due: number
  pipeline: PipelineCounts
  total_case_size: number
  unassigned_count: number
  agents: AgentBreakdown[]
  teams: TeamBreakdown[]
  sources: SourceBreakdown[]
  sources_list: string[]
  teams_list: Array<{ id: string; name: string }>
  agents_list: Array<{ id: string; name: string }>
}

const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_PRODUCTS = new Set(['medical', 'critical_illness', 'life', 'personal_accident'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const p = req.nextUrl.searchParams

  const rawAgent = p.get('agent') ?? null
  const rawTeam = p.get('team') ?? null
  const rawSource = p.get('source') ?? null
  const rawProduct = p.get('product') ?? null

  const agentFilter = profile.role === 'admin' && rawAgent && VALID_UUID.test(rawAgent) ? rawAgent : null
  const teamFilter = profile.role === 'admin' && rawTeam && VALID_UUID.test(rawTeam) ? rawTeam : null
  const sourceFilter =
    (profile.role === 'admin' || profile.role === 'subadmin') && rawSource ? rawSource : null
  const productFilter = rawProduct && VALID_PRODUCTS.has(rawProduct) ? rawProduct : null

  const data = await withUser(profile.id, async (tx) => {
    const agentCond = agentFilter ? tx`AND l.assigned_agent_id = ${agentFilter}::uuid` : tx``
    const sourceCond = sourceFilter ? tx`AND l.source = ${sourceFilter}` : tx``
    const teamCond = teamFilter
      ? tx`AND l.assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = ${teamFilter}::uuid)`
      : tx``
    const productCond = productFilter ? tx`AND ${productFilter}::product = ANY(l.product_interest)` : tx``

    const myt_today_start = tx`date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'`
    const myt_today_end = tx`(date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') + INTERVAL '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur'`

    const [{ new_leads_today }] = await tx<{ new_leads_today: number }[]>`
      SELECT COUNT(*)::int AS new_leads_today
      FROM leads l
      WHERE l.assigned_at >= ${myt_today_start}
        AND l.assigned_at <  ${myt_today_end}
        ${agentCond} ${sourceCond} ${teamCond} ${productCond}
    `

    const [{ follow_ups_due }] = await tx<{ follow_ups_due: number }[]>`
      SELECT COUNT(*)::int AS follow_ups_due
      FROM leads l
      WHERE l.next_follow_up_at IS NOT NULL
        AND l.next_follow_up_at < ${myt_today_end}
        AND l.status NOT IN ('lost', 'unassigned')
        ${agentCond} ${sourceCond} ${teamCond} ${productCond}
    `

    const [row] = await tx<{
      lead_count: number
      potential_count: number
      closed_count: number
      issued_count: number
      lost_count: number
      total_case_size: number
    }[]>`
      SELECT
        COUNT(*) FILTER (WHERE l.status = 'lead')::int          AS lead_count,
        COUNT(*) FILTER (WHERE l.status = 'potential')::int     AS potential_count,
        COUNT(*) FILTER (WHERE l.status = 'closed')::int        AS closed_count,
        COUNT(*) FILTER (WHERE l.status = 'issued')::int        AS issued_count,
        COUNT(*) FILTER (WHERE l.status = 'lost')::int          AS lost_count,
        COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost', 'unassigned')), 0)::numeric
          AS total_case_size
      FROM leads l
      WHERE l.status != 'unassigned'
        ${agentCond} ${sourceCond} ${teamCond} ${productCond}
    `

    const [{ unassigned_count }] = await tx<{ unassigned_count: number }[]>`
      SELECT COUNT(*)::int AS unassigned_count FROM leads l WHERE l.status = 'unassigned'
        ${productCond}
    `

    let agents: AgentBreakdown[] = []
    if (profile.role !== 'agent') {
      agents = await tx<AgentBreakdown[]>`
        SELECT
          p.id                                                               AS agent_id,
          p.full_name                                                        AS agent_name,
          COUNT(l.id) FILTER (WHERE l.status != 'lost')::int                AS total_count,
          COUNT(l.id) FILTER (WHERE l.status = 'lead')::int                 AS lead_count,
          COUNT(l.id) FILTER (WHERE l.status = 'potential')::int            AS potential_count,
          COUNT(l.id) FILTER (WHERE l.status = 'closed')::int               AS closed_count,
          COUNT(l.id) FILTER (WHERE l.status = 'issued')::int               AS issued_count,
          COALESCE(SUM(l.case_size) FILTER (WHERE l.status != 'lost'), 0)::numeric AS case_size
        FROM leads l
        JOIN profiles p ON p.id = l.assigned_agent_id
        WHERE l.status NOT IN ('unassigned', 'lost')
          ${sourceCond} ${teamCond} ${productCond}
        GROUP BY p.id, p.full_name
        ORDER BY total_count DESC
      `
    }

    let teams: TeamBreakdown[] = []
    let sources: SourceBreakdown[] = []
    let sources_list: string[] = []
    let teams_list: Array<{ id: string; name: string }> = []
    let agents_list: Array<{ id: string; name: string }> = []

    if (profile.role === 'admin') {
      teams = await tx<TeamBreakdown[]>`
        SELECT
          t.id                                                                     AS team_id,
          t.name                                                                   AS team_name,
          COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost', 'unassigned'))::int  AS total_count,
          COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost', 'unassigned')), 0)::numeric
            AS case_size
        FROM leads l
        JOIN profiles p ON p.id = l.assigned_agent_id
        LEFT JOIN teams t ON t.id = p.team_id
        WHERE l.status NOT IN ('unassigned', 'lost')
          ${sourceCond} ${agentCond} ${productCond}
        GROUP BY t.id, t.name
        ORDER BY total_count DESC
      `

      sources = await tx<SourceBreakdown[]>`
        SELECT
          l.source,
          COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost', 'unassigned'))::int  AS total_count,
          COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost', 'unassigned')), 0)::numeric
            AS case_size
        FROM leads l
        WHERE l.source IS NOT NULL
          ${agentCond} ${teamCond} ${productCond}
        GROUP BY l.source
        ORDER BY total_count DESC
      `

      const sRows = await tx<{ source: string }[]>`
        SELECT DISTINCT source FROM leads WHERE source IS NOT NULL ORDER BY source
      `
      sources_list = sRows.map((r) => r.source)

      teams_list = await tx<{ id: string; name: string }[]>`
        SELECT id, name FROM teams ORDER BY name
      `

      // Full agents list for the filter dropdown (all active agents, not just those with leads)
      const aRows = await tx<{ id: string; full_name: string }[]>`
        SELECT id, full_name FROM profiles
        WHERE role = 'agent' AND is_active = true
        ORDER BY full_name
      `
      agents_list = aRows.map((r) => ({ id: r.id, name: r.full_name }))
    }

    return {
      new_leads_today,
      follow_ups_due,
      pipeline: {
        lead: row.lead_count,
        potential: row.potential_count,
        closed: row.closed_count,
        issued: row.issued_count,
        lost: row.lost_count,
      },
      total_case_size: Number(row.total_case_size),
      unassigned_count,
      agents,
      teams,
      sources,
      sources_list,
      teams_list,
      agents_list,
    } satisfies DashboardData
  })

  return NextResponse.json(data)
}

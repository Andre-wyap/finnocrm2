import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'

type AgentRow = {
  user_id: string
  user_name: string
  team_name: string | null
  total_count: number
  lead_count: number
  follow_up_count: number
  potential_count: number
  closed_count: number
  issued_count: number
  case_size: number
}

type TeamRow = {
  team_id: string | null
  team_name: string | null
  total_count: number
  case_size: number
}

type SourceRow = {
  source: string
  total_count: number
  case_size: number
}

export type ReportingData = {
  agents: AgentRow[]
  teams: TeamRow[]
  sources: SourceRow[]
  teams_list: Array<{ id: string; name: string }>
  users_list: Array<{ id: string; name: string }>
  sources_list: string[]
}

const VALID_PRODUCTS = new Set(['medical', 'critical_illness', 'life', 'personal_accident'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const p = req.nextUrl.searchParams
  const rawProduct = p.get('product') ?? null
  const rawTeam    = p.get('team')    ?? null
  const rawSource  = p.get('source')  ?? null
  const rawUser    = p.get('user')    ?? null

  if (rawProduct && !VALID_PRODUCTS.has(rawProduct)) {
    return NextResponse.json({ error: 'Invalid product filter' }, { status: 422 })
  }
  if (rawTeam && !isUuid(rawTeam)) {
    return NextResponse.json({ error: 'Invalid team filter' }, { status: 422 })
  }
  if (rawUser && !isUuid(rawUser)) {
    return NextResponse.json({ error: 'Invalid user filter' }, { status: 422 })
  }

  const productFilter: string | null = rawProduct
  const teamFilter:    string | null = rawTeam
  const sourceFilter:  string | null = rawSource  ?? null
  const userFilter:    string | null = rawUser

  // A team leader's boundary — mandatory, not a UI-chosen filter. NULL for
  // subadmin/admin (agency-wide), their own team_id for team_leader.
  const scopeTeamId: string | null = profile.role === 'team_leader' ? profile.team_id : null

  const data = await withUser(profile.id, async (tx) => {
    // Dropdown-list queries — scoped to the team leader's own team so the
    // filter options never leak another team's names; unscoped (NULL) for
    // subadmin/admin gives the same full-agency options as before.
    const teamsAll   = await tx<TeamRow[]>`SELECT * FROM get_reporting_teams(${scopeTeamId}::uuid)`
    const sourcesAll = await tx<SourceRow[]>`SELECT * FROM get_reporting_sources(${scopeTeamId}::uuid)`
    const usersAll   = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM get_assignable_users()
    `

    // Filtered breakdown data for the tables.
    const agentsRaw = await tx<AgentRow[]>`
      SELECT * FROM get_reporting_agents(${scopeTeamId}::uuid, ${productFilter}, ${teamFilter}::uuid, ${sourceFilter})
    `
    const teams   = await tx<TeamRow[]>`
      SELECT * FROM get_reporting_teams(${scopeTeamId}::uuid, ${productFilter}, ${sourceFilter})
    `
    const sources = await tx<SourceRow[]>`
      SELECT * FROM get_reporting_sources(${scopeTeamId}::uuid, ${productFilter}, ${teamFilter}::uuid)
    `

    // User filter applied here so the return type stays AgentRow[] not RowList.
    const agents: AgentRow[] = userFilter
      ? agentsRaw.filter(a => a.user_id === userFilter)
      : [...agentsRaw]

    return {
      agents,
      teams:        [...teams],
      sources:      [...sources],
      teams_list:   teamsAll.filter(t => t.team_id != null).map(t => ({ id: t.team_id!, name: t.team_name! })),
      users_list:   usersAll.map(u => ({ id: u.id, name: u.full_name })),
      sources_list: sourcesAll.map(s => s.source),
    } satisfies ReportingData
  })

  return NextResponse.json(data)
}

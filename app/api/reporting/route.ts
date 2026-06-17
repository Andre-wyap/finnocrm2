import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

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

const VALID_UUID     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

  const productFilter: string | null = rawProduct && VALID_PRODUCTS.has(rawProduct) ? rawProduct : null
  const teamFilter:    string | null = rawTeam    && VALID_UUID.test(rawTeam)   ? rawTeam   : null
  const sourceFilter:  string | null = rawSource  ?? null
  const userFilter:    string | null = rawUser    && VALID_UUID.test(rawUser)   ? rawUser   : null

  const data = await withUser(profile.id, async (tx) => {
    // Unfiltered queries for the filter-dropdown lists.
    // The SECURITY DEFINER functions bypass subadmin's team-scoped profiles RLS,
    // giving both roles the same full-agency dropdown options.
    const teamsAll   = await tx<TeamRow[]>`SELECT * FROM get_reporting_teams()`
    const sourcesAll = await tx<SourceRow[]>`SELECT * FROM get_reporting_sources()`
    const usersAll   = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM get_assignable_users()
    `

    // Filtered breakdown data for the tables.
    const agents  = await tx<AgentRow[]>`
      SELECT * FROM get_reporting_agents(${productFilter}, ${teamFilter}::uuid, ${sourceFilter})
    `
    const teams   = await tx<TeamRow[]>`
      SELECT * FROM get_reporting_teams(${productFilter}, ${sourceFilter})
    `
    const sources = await tx<SourceRow[]>`
      SELECT * FROM get_reporting_sources(${productFilter}, ${teamFilter}::uuid)
    `

    return {
      agents,
      teams,
      sources,
      teams_list:   teamsAll.filter(t => t.team_id != null).map(t => ({ id: t.team_id!, name: t.team_name! })),
      users_list:   usersAll.map(u => ({ id: u.id, name: u.full_name })),
      sources_list: sourcesAll.map(s => s.source),
    } satisfies ReportingData
  })

  // User filter is applied post-fetch (avoids adding a 4th param to get_reporting_agents).
  if (userFilter) {
    data.agents = data.agents.filter(a => a.user_id === userFilter)
  }

  return NextResponse.json(data)
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'

const VALID_STATUSES = new Set(['unassigned', 'lead', 'follow_up', 'potential', 'closed', 'issued', 'lost'])
const VALID_PRODUCTS = new Set(['medical', 'critical_illness', 'life', 'personal_accident'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const p = req.nextUrl.searchParams
  const status = p.get('status') && VALID_STATUSES.has(p.get('status')!) ? p.get('status') : null
  const product = p.get('product') && VALID_PRODUCTS.has(p.get('product')!) ? p.get('product') : null
  const agent = p.get('agent') ?? null
  const team = p.get('team') ?? null
  // archived: default 'false' → active only; 'true' → archived only; 'all' → both.
  const archived = p.get('archived') ?? 'false'
  const parsedLimit = Number.parseInt(p.get('limit') ?? '50', 10)
  const parsedOffset = Number.parseInt(p.get('offset') ?? '0', 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0

  if (agent && !isUuid(agent)) {
    return NextResponse.json({ error: 'Invalid agent filter' }, { status: 422 })
  }
  if (team && !isUuid(team)) {
    return NextResponse.json({ error: 'Invalid team filter' }, { status: 422 })
  }

  const leads = await withUser(profile.id, async (tx) => {
    const statusCond = status ? tx`AND l.status = ${status}::lead_status` : tx``
    const productCond = product ? tx`AND ${product}::product = ANY(l.product_interest)` : tx``
    const agentCond = agent ? tx`AND l.assigned_agent_id = ${agent}::uuid` : tx``
    const teamCond = team ? tx`AND l.team_id = ${team}::uuid` : tx``
    const archivedCond =
      archived === 'true' ? tx`AND l.archived_at IS NOT NULL`
      : archived === 'all' ? tx``
      : tx`AND l.archived_at IS NULL`

    return tx<{
      id: string
      full_name: string
      status: string
      product_interest: string[]
      mobile: string
      source: string
      possible_duplicate: boolean
      case_size: number | null
      created_at: string
      agent_id: string | null
      agent_name: string | null
    }[]>`
      SELECT l.id, l.full_name, l.status, l.product_interest,
             l.mobile, l.source,
             l.possible_duplicate, l.case_size, l.created_at,
             p.id   AS agent_id,
             p.full_name AS agent_name
      FROM leads l
      LEFT JOIN profiles p ON p.id = l.assigned_agent_id
      WHERE 1=1 ${statusCond} ${productCond} ${agentCond} ${teamCond} ${archivedCond}
      ORDER BY l.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  })

  const [{ total }] = await withUser(profile.id, async (tx) => {
    const statusCond = status ? tx`AND l.status = ${status}::lead_status` : tx``
    const productCond = product ? tx`AND ${product}::product = ANY(l.product_interest)` : tx``
    const agentCond = agent ? tx`AND l.assigned_agent_id = ${agent}::uuid` : tx``
    const teamCond = team ? tx`AND l.team_id = ${team}::uuid` : tx``
    const archivedCond =
      archived === 'true' ? tx`AND l.archived_at IS NOT NULL`
      : archived === 'all' ? tx``
      : tx`AND l.archived_at IS NULL`
    return tx<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM leads l
      WHERE 1=1 ${statusCond} ${productCond} ${agentCond} ${teamCond} ${archivedCond}
    `
  })

  return NextResponse.json({ leads, total, limit, offset })
}

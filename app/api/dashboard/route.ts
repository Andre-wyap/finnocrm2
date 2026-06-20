import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { DashboardData } from '@/components/dashboard/DashboardWidgets'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const data = await withUser(profile.id, async (tx) => {
    // Leads assigned today (MYT)
    const [{ new_leads_today }] = await tx<{ new_leads_today: number }[]>`
      SELECT COUNT(*)::int AS new_leads_today
      FROM leads
      WHERE archived_at IS NULL
        AND assigned_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'
        AND assigned_at <  (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') + INTERVAL '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur'
    `

    // Leads that arrived today and are still in the unassigned pool (MYT)
    const [{ unassigned_today }] = await tx<{ unassigned_today: number }[]>`
      SELECT COUNT(*)::int AS unassigned_today
      FROM leads
      WHERE status = 'unassigned'
        AND archived_at IS NULL
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur'
        AND created_at <  (date_trunc('day', NOW() AT TIME ZONE 'Asia/Kuala_Lumpur') + INTERVAL '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur'
    `

    // Pipeline counts + per-stage case sizes in one pass
    const [row] = await tx<{
      lead_count:       number
      follow_up_count:  number
      potential_count:  number
      closed_count:     number
      issued_count:     number
      cs_follow_up:     number
      cs_potential:     number
      cs_closed:        number
      cs_issued:        number
      cs_total:         number
    }[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'lead')::int          AS lead_count,
        COUNT(*) FILTER (WHERE status = 'follow_up')::int     AS follow_up_count,
        COUNT(*) FILTER (WHERE status = 'potential')::int     AS potential_count,
        COUNT(*) FILTER (WHERE status = 'closed')::int        AS closed_count,
        COUNT(*) FILTER (WHERE status = 'issued')::int        AS issued_count,
        COALESCE(SUM(case_size) FILTER (WHERE status = 'follow_up'),  0)::numeric AS cs_follow_up,
        COALESCE(SUM(case_size) FILTER (WHERE status = 'potential'),  0)::numeric AS cs_potential,
        COALESCE(SUM(case_size) FILTER (WHERE status = 'closed'),     0)::numeric AS cs_closed,
        COALESCE(SUM(case_size) FILTER (WHERE status = 'issued'),     0)::numeric AS cs_issued,
        COALESCE(SUM(case_size) FILTER (WHERE status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS cs_total
      FROM leads
      WHERE status NOT IN ('unassigned','lost')
        AND archived_at IS NULL
    `

    return {
      new_leads_today,
      unassigned_today,
      pipeline: {
        lead:      row.lead_count,
        follow_up: row.follow_up_count,
        potential: row.potential_count,
        closed:    row.closed_count,
        issued:    row.issued_count,
      },
      case_size_by_status: {
        follow_up: Number(row.cs_follow_up),
        potential: Number(row.cs_potential),
        closed:    Number(row.cs_closed),
        issued:    Number(row.cs_issued),
        total:     Number(row.cs_total),
      },
    } satisfies DashboardData
  })

  return NextResponse.json(data)
}

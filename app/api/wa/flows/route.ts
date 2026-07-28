import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { WaFlow } from '@/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error
  if (!profile.wa_enabled && profile.role !== 'admin') {
    return NextResponse.json({ error: 'WhatsApp is not enabled for your account' }, { status: 403 })
  }

  const flows = await withUser<WaFlow[]>(profile.id, async (tx) =>
    tx<WaFlow[]>`
      SELECT f.id, f.name, f.is_active, f.created_by, f.created_at, f.updated_at,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', s.id,
                   'flow_id', s.flow_id,
                   'step_order', s.step_order,
                   'template_id', s.template_id,
                   'template_name', t.name,
                   'delay_minutes', s.delay_minutes
                 )
                 ORDER BY s.step_order
               ) FILTER (WHERE s.id IS NOT NULL),
               '[]'::json
             ) AS steps
      FROM wa_flows f
      LEFT JOIN wa_flow_steps s ON s.flow_id = f.id
      LEFT JOIN wa_templates t ON t.id = s.template_id
      WHERE f.is_active = true
      GROUP BY f.id
      HAVING count(s.id) > 0
      ORDER BY f.name
    `
  )
  return NextResponse.json(flows)
}

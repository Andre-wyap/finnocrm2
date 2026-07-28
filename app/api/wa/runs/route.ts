import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import intakeSql from '@/lib/db/intake'
import { isUuid } from '@/lib/validation'
import { jitteredDelayMinutes } from '@/lib/wa/schedule'
import type { WaFlowRun } from '@/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error
  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId || !isUuid(leadId)) {
    return NextResponse.json({ error: 'Invalid lead_id' }, { status: 400 })
  }

  const rows = await withUser<Omit<WaFlowRun, 'next_send_at'>[]>(profile.id, async (tx) =>
    tx<Omit<WaFlowRun, 'next_send_at'>[]>`
      SELECT r.id, r.flow_id, f.name AS flow_name, r.lead_id,
             r.sender_profile_id, p.full_name AS sender_name,
             r.status, r.current_step,
             (SELECT count(*)::int FROM wa_flow_steps s WHERE s.flow_id = r.flow_id) AS total_steps,
             r.last_error, r.started_by, r.started_at, r.finished_at
      FROM wa_flow_runs r
      JOIN wa_flows f ON f.id = r.flow_id
      JOIN profiles p ON p.id = r.sender_profile_id
      WHERE r.lead_id = ${leadId}::uuid
        AND r.status = 'running'
      ORDER BY r.started_at DESC
      LIMIT 1
    `
  )
  const run = rows[0]
  if (!run) return NextResponse.json(null)

  const [nextJob] = await intakeSql<{ run_at: string }[]>`
    SELECT run_at
    FROM wa_jobs
    WHERE run_id = ${run.id}::uuid AND status = 'pending'
    ORDER BY run_at
    LIMIT 1
  `
  return NextResponse.json({ ...run, next_send_at: nextJob?.run_at ?? null })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  let body: { flow_id?: string; lead_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.flow_id || !isUuid(body.flow_id)) {
    return NextResponse.json({ error: 'Invalid flow_id' }, { status: 422 })
  }
  if (!Array.isArray(body.lead_ids) || body.lead_ids.length === 0 || body.lead_ids.length > 100) {
    return NextResponse.json({ error: 'lead_ids must contain between 1 and 100 leads' }, { status: 422 })
  }
  const leadIds = [...new Set(body.lead_ids)]
  if (!leadIds.every(isUuid)) return NextResponse.json({ error: 'Invalid lead id' }, { status: 422 })
  const flowId = body.flow_id

  const flowRows = await withUser<{
    id: string
    first_step_id: string
    first_template_id: string
    first_delay_minutes: number
  }[]>(profile.id, async (tx) =>
    tx<{
      id: string
      first_step_id: string
      first_template_id: string
      first_delay_minutes: number
    }[]>`
      SELECT f.id, s.id AS first_step_id, s.template_id AS first_template_id,
             s.delay_minutes AS first_delay_minutes
      FROM wa_flows f
      JOIN wa_flow_steps s ON s.flow_id = f.id AND s.step_order = 1
      JOIN wa_templates t ON t.id = s.template_id AND t.is_active = true
      WHERE f.id = ${flowId}::uuid AND f.is_active = true
      LIMIT 1
    `
  )
  const flow = flowRows[0]
  if (!flow) return NextResponse.json({ error: 'Active flow not found or its first template is inactive' }, { status: 404 })

  const visibleLeads = await withUser<{ id: string }[]>(profile.id, async (tx) =>
    tx<{ id: string }[]>`
      SELECT id FROM leads
      WHERE id = ANY(${leadIds}::uuid[])
        AND archived_at IS NULL
        AND status <> 'lost'
    `
  )
  const visibleIds = new Set(visibleLeads.map((lead) => lead.id))

  const started: Array<{ lead_id: string; run_id: string }> = []
  const skipped: Array<{ lead_id: string; reason: string }> = []
  for (const leadId of leadIds) {
    if (!visibleIds.has(leadId)) {
      skipped.push({ lead_id: leadId, reason: 'Lead is unavailable, archived, lost, or outside your access' })
      continue
    }

    const [sender] = await intakeSql<{
      sender_profile_id: string | null
      wa_enabled: boolean | null
      instance_status: string | null
    }[]>`
      SELECT l.assigned_agent_id AS sender_profile_id,
             p.wa_enabled,
             wi.status::text AS instance_status
      FROM leads l
      LEFT JOIN profiles p ON p.id = l.assigned_agent_id AND p.is_active = true
      LEFT JOIN wa_instances wi ON wi.profile_id = l.assigned_agent_id
      WHERE l.id = ${leadId}::uuid
      LIMIT 1
    `
    if (!sender?.sender_profile_id) {
      skipped.push({ lead_id: leadId, reason: 'Lead is not assigned' })
      continue
    }
    if (!sender.wa_enabled || sender.instance_status !== 'connected') {
      skipped.push({ lead_id: leadId, reason: 'Assigned agent is not WhatsApp-enabled and connected' })
      continue
    }

    try {
      const runId = await intakeSql.begin(async (tx) => {
        const [run] = await tx<{ id: string }[]>`
          INSERT INTO wa_flow_runs (
            flow_id, lead_id, sender_profile_id, status, current_step, started_by
          )
          VALUES (
            ${flowId}::uuid, ${leadId}::uuid, ${sender.sender_profile_id}::uuid,
            'running', 0, ${profile.id}::uuid
          )
          RETURNING id
        `
        const delay = jitteredDelayMinutes(flow.first_delay_minutes)
        await tx`
          INSERT INTO wa_jobs (
            run_id, flow_step_id, lead_id, template_id, sender_profile_id, run_at
          )
          VALUES (
            ${run.id}::uuid, ${flow.first_step_id}::uuid, ${leadId}::uuid,
            ${flow.first_template_id}::uuid, ${sender.sender_profile_id}::uuid,
            now() + (${delay} * interval '1 minute')
          )
        `
        return run.id
      })
      started.push({ lead_id: leadId, run_id: runId })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        skipped.push({ lead_id: leadId, reason: 'Lead already has an active flow' })
      } else {
        console.error('[wa/runs POST] start failed:', err)
        skipped.push({ lead_id: leadId, reason: 'Could not start flow' })
      }
    }
  }

  return NextResponse.json({ started, skipped }, { status: started.length > 0 ? 201 : 409 })
}

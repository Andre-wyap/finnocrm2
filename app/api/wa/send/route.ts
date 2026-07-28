import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import intakeSql from '@/lib/db/intake'
import { isUuid } from '@/lib/validation'
import { getWhatsAppSafetyConfig, nextAllowedWhatsAppSendAt } from '@/lib/wa/schedule'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error
  if (!profile.wa_enabled) {
    return NextResponse.json({ error: 'WhatsApp is not enabled for your account' }, { status: 403 })
  }

  let body: { lead_id?: string; template_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.lead_id || !isUuid(body.lead_id)) {
    return NextResponse.json({ error: 'Invalid lead_id' }, { status: 422 })
  }
  if (!body.template_id || !isUuid(body.template_id)) {
    return NextResponse.json({ error: 'Invalid template_id' }, { status: 422 })
  }
  const leadId = body.lead_id
  const templateId = body.template_id

  const eligibleRows = await withUser<{ lead_id: string; template_id: string; instance_name: string }[]>(
    profile.id,
    async (tx) =>
    tx<{ lead_id: string; template_id: string; instance_name: string }[]>`
      SELECT l.id AS lead_id, t.id AS template_id, wi.instance_name
      FROM leads l
      JOIN wa_templates t ON t.id = ${templateId}::uuid AND t.is_active = true
      JOIN wa_instances wi ON wi.profile_id = ${profile.id}::uuid AND wi.status = 'connected'
      WHERE l.id = ${leadId}::uuid
        AND l.assigned_agent_id = ${profile.id}::uuid
        AND l.archived_at IS NULL
        AND l.status <> 'lost'
        AND length(trim(l.mobile)) > 0
      LIMIT 1
    `
  )
  const eligible = eligibleRows[0]
  if (!eligible) {
    return NextResponse.json(
      { error: 'Lead must be active, assigned to you, and your WhatsApp must be connected' },
      { status: 409 }
    )
  }

  const safety = getWhatsAppSafetyConfig()
  const runAt = nextAllowedWhatsAppSendAt(new Date(), safety.quietHours)
  const [job] = await intakeSql<{ id: string; run_at: string }[]>`
    INSERT INTO wa_jobs (lead_id, template_id, sender_profile_id, run_at)
    VALUES (${leadId}::uuid, ${templateId}::uuid, ${profile.id}::uuid, ${runAt})
    RETURNING id, run_at
  `
  return NextResponse.json({ job_id: job.id, status: 'pending', run_at: job.run_at }, { status: 202 })
}

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import intakeSql from '@/lib/db/intake'
import { sendMedia, sendText } from '@/lib/wa/evolution'
import { normalizeWhatsAppNumber } from '@/lib/wa/phone'
import { renderWhatsAppTemplate } from '@/lib/wa/render'
import { jitteredDelayMinutes } from '@/lib/wa/schedule'

type ClaimedJob = { id: string }
type JobPayload = {
  id: string
  run_id: string | null
  flow_step_id: string | null
  lead_id: string
  sender_profile_id: string
  attempts: number
  full_name: string
  mobile: string
  state: string | null
  product_interest: string[]
  assigned_agent_id: string | null
  lead_status: string
  archived_at: string | null
  template_name: string
  template_body: string
  instance_name: string | null
  instance_status: string | null
  sender_name: string
  sender_enabled: boolean
  media_file_name: string | null
  media_mime_type: string | null
  media_data: Buffer | null
  flow_id: string | null
  flow_name: string | null
  run_status: string | null
  step_order: number | null
  total_steps: number | null
}

function validWorkerSecret(req: NextRequest): boolean {
  const expected = process.env.WA_WORKER_SECRET
  const actual = req.headers.get('x-worker-secret')
  if (!expected || !actual) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

async function failJob(id: string, message: string): Promise<void> {
  const error = message.slice(0, 1000)
  await intakeSql.begin(async (tx) => {
    const [job] = await tx<{ run_id: string | null }[]>`
      UPDATE wa_jobs
      SET status = 'failed', last_error = ${error}
      WHERE id = ${id}::uuid
      RETURNING run_id
    `
    if (job?.run_id) {
      await tx`
        UPDATE wa_flow_runs
        SET status = 'failed', last_error = ${error}, finished_at = now()
        WHERE id = ${job.run_id}::uuid AND status = 'running'
      `
    }
  })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validWorkerSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validWorkerSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const claimed = await intakeSql.begin(async (tx) =>
    tx<ClaimedJob[]>`
      WITH picked AS (
        SELECT id
        FROM wa_jobs
        WHERE status = 'pending' AND run_at <= now()
        ORDER BY run_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 20
      )
      UPDATE wa_jobs j
      SET status = 'processing', attempts = attempts + 1, last_error = NULL
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.id
    `
  )

  const results: Array<{ id: string; status: 'sent' | 'failed'; error?: string }> = []
  for (const claimedJob of claimed) {
    const [job] = await intakeSql<JobPayload[]>`
      SELECT j.id, j.run_id, j.flow_step_id,
             j.lead_id, j.sender_profile_id, j.attempts,
             l.full_name, l.mobile, l.state, l.product_interest::text[],
             l.assigned_agent_id, l.status::text AS lead_status, l.archived_at,
             t.name AS template_name, t.body AS template_body,
             wi.instance_name, wi.status::text AS instance_status,
             p.full_name AS sender_name, p.wa_enabled AS sender_enabled,
             m.file_name AS media_file_name, m.mime_type AS media_mime_type,
             m.data AS media_data,
             r.flow_id, f.name AS flow_name, r.status::text AS run_status,
             fs.step_order,
             CASE WHEN r.id IS NULL THEN NULL ELSE (
               SELECT count(*)::int FROM wa_flow_steps count_steps
               WHERE count_steps.flow_id = r.flow_id
             ) END AS total_steps
      FROM wa_jobs j
      JOIN leads l ON l.id = j.lead_id
      JOIN wa_templates t ON t.id = j.template_id
      JOIN profiles p ON p.id = j.sender_profile_id
      LEFT JOIN wa_instances wi ON wi.profile_id = j.sender_profile_id
      LEFT JOIN wa_media m ON m.id = t.media_id
      LEFT JOIN wa_flow_runs r ON r.id = j.run_id
      LEFT JOIN wa_flows f ON f.id = r.flow_id
      LEFT JOIN wa_flow_steps fs ON fs.id = j.flow_step_id
      WHERE j.id = ${claimedJob.id}::uuid
      LIMIT 1
    `

    if (!job) {
      await failJob(claimedJob.id, 'Job payload not found')
      results.push({ id: claimedJob.id, status: 'failed', error: 'Job payload not found' })
      continue
    }

    let guardError: string | null = null
    if (job.run_id && job.run_status !== 'running') {
      await intakeSql`
        UPDATE wa_jobs
        SET status = 'cancelled', last_error = NULL
        WHERE id = ${job.id}::uuid
      `
      continue
    }
    if (job.run_id && (!job.flow_id || !job.flow_step_id || !job.step_order)) {
      guardError = 'Flow job is missing its run or step'
    } else if (job.archived_at) guardError = 'Lead is archived'
    else if (job.lead_status === 'lost') guardError = 'Lead is marked lost'
    else if (job.assigned_agent_id !== job.sender_profile_id) guardError = 'Lead is no longer assigned to this sender'
    else if (!job.sender_enabled) guardError = 'Sender is no longer WhatsApp-enabled'
    else if (job.instance_status !== 'connected' || !job.instance_name) guardError = 'Sender WhatsApp is not connected'

    const number = normalizeWhatsAppNumber(job.mobile)
    if (!guardError && !number) guardError = 'Lead has no valid mobile number'
    if (guardError) {
      await failJob(job.id, guardError)
      results.push({ id: job.id, status: 'failed', error: guardError })
      continue
    }

    const rendered = renderWhatsAppTemplate(job.template_body, {
      full_name: job.full_name,
      agent_name: job.sender_name,
      state: job.state,
      product_interest: job.product_interest,
    })

    try {
      if (job.media_data && job.media_file_name && job.media_mime_type) {
        await sendMedia(job.instance_name!, {
          number: number!,
          mimeType: job.media_mime_type,
          fileName: job.media_file_name,
          base64: job.media_data.toString('base64'),
          caption: rendered.text,
        })
      } else {
        await sendText(job.instance_name!, number!, rendered.text)
      }

      await intakeSql.begin(async (tx) => {
        await tx`
          UPDATE wa_jobs
          SET status = 'sent', sent_at = now(), last_error = NULL
          WHERE id = ${job.id}::uuid
        `
        await tx`
          INSERT INTO activities (lead_id, user_id, type, content)
          VALUES (
            ${job.lead_id}::uuid,
            ${job.sender_profile_id}::uuid,
            'wa_message',
            ${
              job.run_id
                ? `WhatsApp template “${job.template_name}” sent by ${job.sender_name} (flow “${job.flow_name}”, step ${job.step_order} of ${job.total_steps})`
                : `WhatsApp template “${job.template_name}” sent by ${job.sender_name}`
            }
          )
        `
        if (job.run_id && job.flow_id && job.step_order) {
          const [runningRun] = await tx<{ id: string }[]>`
            UPDATE wa_flow_runs
            SET current_step = ${job.step_order}, last_error = NULL
            WHERE id = ${job.run_id}::uuid AND status = 'running'
            RETURNING id
          `
          if (runningRun) {
            const [nextStep] = await tx<{
              id: string
              template_id: string
              delay_minutes: number
            }[]>`
              SELECT id, template_id, delay_minutes
              FROM wa_flow_steps
              WHERE flow_id = ${job.flow_id}::uuid
                AND step_order > ${job.step_order}
              ORDER BY step_order
              LIMIT 1
            `
            if (nextStep) {
              const delay = jitteredDelayMinutes(nextStep.delay_minutes)
              await tx`
                INSERT INTO wa_jobs (
                  run_id, flow_step_id, lead_id, template_id,
                  sender_profile_id, run_at
                )
                VALUES (
                  ${job.run_id}::uuid, ${nextStep.id}::uuid,
                  ${job.lead_id}::uuid, ${nextStep.template_id}::uuid,
                  ${job.sender_profile_id}::uuid,
                  now() + (${delay} * interval '1 minute')
                )
              `
            } else {
              await tx`
                UPDATE wa_flow_runs
                SET status = 'completed', finished_at = now()
                WHERE id = ${job.run_id}::uuid AND status = 'running'
              `
            }
          }
        }
      })
      results.push({ id: job.id, status: 'sent' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await failJob(job.id, message)
      results.push({ id: job.id, status: 'failed', error: message })
    }
  }

  return NextResponse.json({
    claimed: claimed.length,
    sent: results.filter((item) => item.status === 'sent').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  })
}

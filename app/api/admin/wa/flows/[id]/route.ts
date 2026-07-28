import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'
import { listFlows, validateFlow } from '@/lib/wa/flow-admin'
import type { FlowStepInput } from '@/lib/wa/flow-admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid flow id' }, { status: 400 })

  let body: { name?: string; is_active?: boolean; steps?: FlowStepInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const name = body.name?.trim() ?? ''
  const validation = validateFlow(name, body.steps ?? [])
  if ('error' in validation) return NextResponse.json({ error: validation.error }, { status: 422 })
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 422 })
  }

  try {
    const updated = await withUser<boolean>(profile.id, async (tx) => {
      const [existing] = await tx<{ id: string; running_count: number }[]>`
        SELECT f.id,
               (SELECT count(*)::int FROM wa_flow_runs r
                WHERE r.flow_id = f.id AND r.status = 'running') AS running_count
        FROM wa_flows f
        WHERE f.id = ${id}::uuid
        FOR UPDATE
      `
      if (!existing) return false
      if (existing.running_count > 0) throw new Error('ACTIVE_RUNS')

      const templateIds = validation.steps.map((step) => step.template_id)
      const templates = await tx<{ id: string }[]>`
        SELECT id FROM wa_templates WHERE id = ANY(${templateIds}::uuid[])
      `
      if (templates.length !== new Set(templateIds).size) throw new Error('INVALID_TEMPLATE')

      await tx`
        UPDATE wa_flows
        SET name = ${name}, is_active = ${body.is_active ?? true}
        WHERE id = ${id}::uuid
      `
      await tx`DELETE FROM wa_flow_steps WHERE flow_id = ${id}::uuid`
      for (const [index, step] of validation.steps.entries()) {
        await tx`
          INSERT INTO wa_flow_steps (flow_id, step_order, template_id, delay_minutes)
          VALUES (${id}::uuid, ${index + 1}, ${step.template_id}::uuid, ${step.delay_minutes})
        `
      }
      return true
    })
    if (!updated) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    const flows = await listFlows(profile.id)
    return NextResponse.json(flows.find((flow) => flow.id === id))
  } catch (err) {
    if (err instanceof Error && err.message === 'ACTIVE_RUNS') {
      return NextResponse.json({ error: 'Cancel or complete active runs before editing this flow' }, { status: 409 })
    }
    if (err instanceof Error && err.message === 'INVALID_TEMPLATE') {
      return NextResponse.json({ error: 'One or more templates do not exist' }, { status: 422 })
    }
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A flow with this name already exists' }, { status: 409 })
    }
    console.error('[admin/wa/flows PATCH] DB error:', err)
    return NextResponse.json({ error: 'Could not update flow' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid flow id' }, { status: 400 })

  try {
    const rows = await withUser<{ id: string }[]>(profile.id, async (tx) =>
      tx<{ id: string }[]>`DELETE FROM wa_flows WHERE id = ${id}::uuid RETURNING id`
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      return NextResponse.json(
        { error: 'This flow has run history and cannot be deleted. Deactivate it instead.' },
        { status: 409 }
      )
    }
    console.error('[admin/wa/flows DELETE] DB error:', err)
    return NextResponse.json({ error: 'Could not delete flow' }, { status: 500 })
  }
}

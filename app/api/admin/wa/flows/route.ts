import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { listFlows, validateFlow } from '@/lib/wa/flow-admin'
import type { FlowStepInput } from '@/lib/wa/flow-admin'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json(await listFlows(profile.id))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

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
    const flowId = await withUser<string>(profile.id, async (tx) => {
      const templateIds = validation.steps.map((step) => step.template_id)
      const templates = await tx<{ id: string }[]>`
        SELECT id FROM wa_templates WHERE id = ANY(${templateIds}::uuid[])
      `
      if (templates.length !== new Set(templateIds).size) throw new Error('INVALID_TEMPLATE')

      const [flow] = await tx<{ id: string }[]>`
        INSERT INTO wa_flows (name, is_active, created_by)
        VALUES (${name}, ${body.is_active ?? true}, ${profile.id}::uuid)
        RETURNING id
      `
      for (const [index, step] of validation.steps.entries()) {
        await tx`
          INSERT INTO wa_flow_steps (flow_id, step_order, template_id, delay_minutes)
          VALUES (${flow.id}::uuid, ${index + 1}, ${step.template_id}::uuid, ${step.delay_minutes})
        `
      }
      return flow.id
    })
    const flows = await listFlows(profile.id)
    return NextResponse.json(flows.find((flow) => flow.id === flowId), { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_TEMPLATE') {
      return NextResponse.json({ error: 'One or more templates do not exist' }, { status: 422 })
    }
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A flow with this name already exists' }, { status: 409 })
    }
    console.error('[admin/wa/flows POST] DB error:', err)
    return NextResponse.json({ error: 'Could not create flow' }, { status: 500 })
  }
}

import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'
import type { WaFlow } from '@/types'

export type FlowStepInput = { template_id?: string; delay_minutes?: number }

export function validateFlow(
  name: string,
  steps: FlowStepInput[]
): { steps: Array<{ template_id: string; delay_minutes: number }> } | { error: string } {
  if (!name) return { error: 'Flow name is required' }
  if (name.length > 100) return { error: 'Flow name must be 100 characters or fewer' }
  if (!Array.isArray(steps) || steps.length === 0) return { error: 'Add at least one flow step' }
  if (steps.length > 50) return { error: 'A flow can have at most 50 steps' }

  const validated: Array<{ template_id: string; delay_minutes: number }> = []
  for (const step of steps) {
    if (!step.template_id || !isUuid(step.template_id)) return { error: 'Each step needs a valid template' }
    const delay = Number(step.delay_minutes)
    if (!Number.isInteger(delay) || delay < 0 || delay > 525600) {
      return { error: 'Step delays must be whole minutes between 0 and 525,600' }
    }
    validated.push({ template_id: step.template_id, delay_minutes: delay })
  }
  return { steps: validated }
}

export async function listFlows(profileId: string): Promise<WaFlow[]> {
  return withUser<WaFlow[]>(profileId, async (tx) =>
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
      GROUP BY f.id
      ORDER BY f.name
    `
  )
}

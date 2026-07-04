import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuidArray } from '@/lib/validation'

// Admin-only bulk maintenance for leads: archive (soft-hide, recoverable),
// restore, and permanent delete. Archive/restore log an audit activity per lead;
// delete cascade-removes the lead and its activities (leads.id ON DELETE CASCADE).

type Action = 'archive' | 'restore' | 'delete'
const VALID_ACTIONS = new Set<Action>(['archive', 'restore', 'delete'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  let body: { action?: unknown; lead_ids?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, lead_ids } = body

  if (typeof action !== 'string' || !VALID_ACTIONS.has(action as Action)) {
    return NextResponse.json({ error: 'action must be archive, restore, or delete' }, { status: 422 })
  }
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ error: 'lead_ids must be a non-empty array' }, { status: 422 })
  }
  if (!isUuidArray(lead_ids)) {
    return NextResponse.json({ error: 'lead_ids must contain only valid UUIDs' }, { status: 422 })
  }

  const leadIds = lead_ids

  try {
    if (action === 'archive') {
      const archived = await withUser(profile.id, async (tx) => {
        const [{ n }] = await tx<{ n: number }[]>`
          WITH updated AS (
            UPDATE leads
            SET    archived_at = NOW(),
                   archived_by = ${profile.id}::uuid
            WHERE  id = ANY(${leadIds}::uuid[])
              AND  archived_at IS NULL
            RETURNING id
          ),
          ins AS (
            INSERT INTO activities (lead_id, user_id, type, content)
            SELECT id, ${profile.id}::uuid, 'archive', ${`${profile.full_name} archived this lead`}
            FROM   updated
          )
          SELECT COUNT(*)::int AS n FROM updated
        `
        return n
      })
      return NextResponse.json({ archived, skipped: leadIds.length - archived })
    }

    if (action === 'restore') {
      const restored = await withUser(profile.id, async (tx) => {
        const [{ n }] = await tx<{ n: number }[]>`
          WITH updated AS (
            UPDATE leads
            SET    archived_at = NULL,
                   archived_by = NULL
            WHERE  id = ANY(${leadIds}::uuid[])
              AND  archived_at IS NOT NULL
            RETURNING id
          ),
          ins AS (
            INSERT INTO activities (lead_id, user_id, type, content)
            SELECT id, ${profile.id}::uuid, 'restore', ${`${profile.full_name} restored this lead`}
            FROM   updated
          )
          SELECT COUNT(*)::int AS n FROM updated
        `
        return n
      })
      return NextResponse.json({ restored, skipped: leadIds.length - restored })
    }

    // delete — permanent; activities cascade via leads FK ON DELETE CASCADE
    const deleted = await withUser(profile.id, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        DELETE FROM leads WHERE id = ANY(${leadIds}::uuid[]) RETURNING id
      `
      return rows.length
    })
    return NextResponse.json({ deleted, skipped: leadIds.length - deleted })
  } catch (err) {
    console.error('[admin/leads/bulk] DB error:', err)
    return NextResponse.json({ error: `Bulk ${action} failed` }, { status: 500 })
  }
}

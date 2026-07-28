import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import intakeSql from '@/lib/db/intake'
import { isUuid } from '@/lib/validation'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  const rows = await withUser<{
    id: string
    started_by: string
    sender_profile_id: string
    status: string
  }[]>(
    profile.id,
    async (tx) =>
      tx<{ id: string; started_by: string; sender_profile_id: string; status: string }[]>`
        SELECT id, started_by, sender_profile_id, status
        FROM wa_flow_runs
        WHERE id = ${id}::uuid
        LIMIT 1
      `
  )
  const run = rows[0]
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (
    run.started_by !== profile.id
    && run.sender_profile_id !== profile.id
    && profile.role !== 'admin'
  ) {
    return NextResponse.json(
      { error: 'Only the sender, the person who started this flow, or an admin can cancel it' },
      { status: 403 }
    )
  }
  if (run.status !== 'running') {
    return NextResponse.json({ error: `Run is already ${run.status}` }, { status: 409 })
  }

  await intakeSql.begin(async (tx) => {
    await tx`
      UPDATE wa_flow_runs
      SET status = 'cancelled', finished_at = now()
      WHERE id = ${id}::uuid AND status = 'running'
    `
    await tx`
      UPDATE wa_jobs
      SET status = 'cancelled', last_error = 'Flow cancelled',
          processing_started_at = NULL
      WHERE run_id = ${id}::uuid AND status IN ('pending', 'processing')
    `
  })
  return NextResponse.json({ ok: true })
}

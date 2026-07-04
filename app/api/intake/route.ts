import { NextRequest, NextResponse } from 'next/server'
import intakeSql from '@/lib/db/intake'

const VALID_PRODUCTS = ['medical', 'critical_illness', 'life', 'personal_accident'] as const
type ValidProduct = (typeof VALID_PRODUCTS)[number]

const INTAKE_SECRET = process.env.INTAKE_SECRET

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Shared-secret check — n8n/WordPress must send X-Intake-Secret.
  // Missing server config fails closed so intake never becomes public by accident.
  if (!INTAKE_SECRET) {
    console.error('[intake] INTAKE_SECRET is not configured')
    return NextResponse.json({ error: 'Intake is not configured' }, { status: 500 })
  }

  if (request.headers.get('x-intake-secret') !== INTAKE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 3. Required fields
  const full_name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : ''

  if (!full_name || !mobile) {
    return NextResponse.json({ error: 'full_name and mobile are required' }, { status: 422 })
  }

  // 4. Optional fields — validate or default
  const date_of_birth =
    typeof body.date_of_birth === 'string' && body.date_of_birth ? body.date_of_birth : null
  const gender = body.gender === 'male' || body.gender === 'female' ? (body.gender as string) : null
  const smoking_status =
    body.smoking_status === 'smoker' || body.smoking_status === 'non_smoker'
      ? (body.smoking_status as string)
      : null
  const email = typeof body.email === 'string' && body.email ? body.email.trim() : null
  const source =
    typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'unknown'

  // product_interest — defaults to ['medical'] if absent or fully invalid
  let product_interest: ValidProduct[]
  if (Array.isArray(body.product_interest)) {
    product_interest = (body.product_interest as unknown[]).filter(
      (p): p is ValidProduct => VALID_PRODUCTS.includes(p as ValidProduct)
    )
  } else if (
    typeof body.product_interest === 'string' &&
    VALID_PRODUCTS.includes(body.product_interest as ValidProduct)
  ) {
    product_interest = [body.product_interest as ValidProduct]
  } else {
    product_interest = []
  }
  if (product_interest.length === 0) product_interest = ['medical']

  // 5. Duplicate check — same mobile submitted in the last 24 h
  let possible_duplicate = false
  try {
    const [{ count }] = await intakeSql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM leads
      WHERE mobile = ${mobile}
        AND created_at > NOW() - INTERVAL '24 hours'
    `
    possible_duplicate = parseInt(count, 10) > 0
  } catch (err) {
    console.error('[intake] duplicate check failed:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // 5b. Resolve the owning team from the source → team map.
  // An unmapped source leaves team_id NULL — an orphan lead visible only to
  // subadmin/admin until an admin maps the source (or assigns it directly).
  let team_id: string | null = null
  try {
    const rows = await intakeSql<{ team_id: string }[]>`
      SELECT team_id FROM team_sources WHERE source = ${source}
    `
    team_id = rows[0]?.team_id ?? null
  } catch (err) {
    console.error('[intake] team_sources lookup failed:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // 6. Insert — intake_role has BYPASSRLS so no SET LOCAL needed
  let leadId: string
  try {
    const [row] = await intakeSql<{ id: string }[]>`
      INSERT INTO leads (
        full_name, date_of_birth, gender, smoking_status,
        email, mobile, source, team_id, product_interest,
        status, assigned_agent_id, possible_duplicate, raw_payload
      ) VALUES (
        ${full_name},
        ${date_of_birth}::date,
        ${gender}::gender,
        ${smoking_status}::smoking_status,
        ${email},
        ${mobile},
        ${source},
        ${team_id}::uuid,
        ${intakeSql.array(product_interest)}::product[],
        'unassigned',
        NULL,
        ${possible_duplicate},
        ${JSON.stringify(body)}::jsonb
      )
      RETURNING id
    `
    leadId = row.id
  } catch (err) {
    console.error('[intake] insert failed:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: leadId, team_id, possible_duplicate })
}

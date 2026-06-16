import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import sql from '@/lib/db/client'
import type { LeadStatus } from '@/types'

const VALID_STATUSES = new Set<string>(['unassigned', 'lead', 'potential', 'closed', 'issued', 'lost'])
const VALID_GENDERS = new Set<string | null>(['male', 'female', null])
const VALID_SMOKING = new Set<string | null>(['smoker', 'non_smoker', null])
const VALID_PRODUCTS = new Set<string>(['medical', 'critical_illness', 'life', 'personal_accident'])

type LeadDetail = {
  id: string
  full_name: string
  date_of_birth: string | null
  gender: string | null
  smoking_status: string | null
  mobile: string
  email: string | null
  state: string | null
  source: string
  product_interest: string[]
  status: LeadStatus
  assigned_agent_id: string | null
  assigned_by: string | null
  assigned_at: string | null
  case_size: number | null
  next_follow_up_at: string | null
  possible_duplicate: boolean
  created_at: string
  updated_at: string
  agent_name: string | null
  assigned_by_name: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const { id } = await params

  const rows = await withUser(profile.id, (tx) =>
    tx<LeadDetail[]>`
      SELECT l.*,
             ap.full_name AS agent_name,
             bp.full_name AS assigned_by_name
      FROM leads l
      LEFT JOIN profiles ap ON ap.id = l.assigned_agent_id
      LEFT JOIN profiles bp ON bp.id = l.assigned_by
      WHERE l.id = ${id}::uuid
    `
  )

  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const { id } = await params

  let body: {
    full_name?: string
    date_of_birth?: string | null
    gender?: string | null
    smoking_status?: string | null
    mobile?: string
    email?: string | null
    state?: string | null
    case_size?: number | string | null
    status?: string
    next_follow_up_at?: string | null
    product_interest?: string[]
    possible_duplicate?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 422 })
  }
  if (body.gender !== undefined && !VALID_GENDERS.has(body.gender)) {
    return NextResponse.json({ error: 'Invalid gender' }, { status: 422 })
  }
  if (body.smoking_status !== undefined && !VALID_SMOKING.has(body.smoking_status)) {
    return NextResponse.json({ error: 'Invalid smoking_status' }, { status: 422 })
  }
  if (body.product_interest !== undefined) {
    if (!Array.isArray(body.product_interest) || body.product_interest.length === 0) {
      return NextResponse.json({ error: 'product_interest must be a non-empty array' }, { status: 422 })
    }
    if (!body.product_interest.every((p) => VALID_PRODUCTS.has(p))) {
      return NextResponse.json({ error: 'Invalid product in product_interest' }, { status: 422 })
    }
  }

  const updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) updates.full_name = body.full_name.trim()
  if (body.date_of_birth !== undefined) updates.date_of_birth = body.date_of_birth ?? null
  if (body.gender !== undefined) updates.gender = body.gender ?? null
  if (body.smoking_status !== undefined) updates.smoking_status = body.smoking_status ?? null
  if (body.mobile !== undefined) updates.mobile = body.mobile.trim()
  if (body.email !== undefined) updates.email = body.email?.trim() ?? null
  if (body.state !== undefined) updates.state = body.state?.trim() ?? null
  if (body.case_size !== undefined) {
    updates.case_size = body.case_size !== null && body.case_size !== '' ? Number(body.case_size) : null
  }
  if (body.status !== undefined) updates.status = body.status
  if (body.next_follow_up_at !== undefined) updates.next_follow_up_at = body.next_follow_up_at ?? null
  if (body.possible_duplicate !== undefined && typeof body.possible_duplicate === 'boolean') {
    updates.possible_duplicate = body.possible_duplicate
  }

  const productInterest = Array.isArray(body.product_interest) ? body.product_interest : null
  const hasScalar = Object.keys(updates).length > 0
  const hasProduct = productInterest !== null

  if (!hasScalar && !hasProduct) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  let result: { id: string }[]
  try {
    result = await withUser(profile.id, async (tx) => {
      if (hasScalar && hasProduct) {
        return tx<{ id: string }[]>`
          UPDATE leads
          SET ${tx(updates)}, product_interest = ${sql.array(productInterest!)}::product[]
          WHERE id = ${id}::uuid
          RETURNING id
        `
      } else if (hasScalar) {
        return tx<{ id: string }[]>`
          UPDATE leads SET ${tx(updates)} WHERE id = ${id}::uuid RETURNING id
        `
      } else {
        return tx<{ id: string }[]>`
          UPDATE leads
          SET product_interest = ${sql.array(productInterest!)}::product[]
          WHERE id = ${id}::uuid
          RETURNING id
        `
      }
    })
  } catch (err) {
    console.error('[leads/[id] PATCH] DB error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!result || result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

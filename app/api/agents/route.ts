import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'

export type AssignableUser = {
  id: string
  full_name: string
  role: string
  team_id: string | null
  team_name: string | null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (profile.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // get_assignable_users() is SECURITY DEFINER — bypasses team-scoped profiles
  // RLS so both admin and subadmin see all active users for the assignment dropdown.
  const users = await withUser(profile.id, (tx) =>
    tx<AssignableUser[]>`SELECT * FROM get_assignable_users()`
  )

  return NextResponse.json(users)
}

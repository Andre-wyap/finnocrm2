import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from './verify'
import type { Profile } from '@/types'

type SessionProfile = Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'team_id'>
type GuardResult =
  | { profile: SessionProfile; error: null }
  | { profile: null; error: NextResponse }

export async function requireAdmin(req: NextRequest): Promise<GuardResult> {
  const profile = await resolveUser(req.headers.get('authorization'))
  if (!profile) return { profile: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'admin') return { profile: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { profile, error: null }
}

export async function requireAuth(req: NextRequest): Promise<GuardResult> {
  const profile = await resolveUser(req.headers.get('authorization'))
  if (!profile) return { profile: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { profile, error: null }
}

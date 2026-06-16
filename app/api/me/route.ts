import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/verify'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const profile = await resolveUser(request.headers.get('authorization'))
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(profile)
}

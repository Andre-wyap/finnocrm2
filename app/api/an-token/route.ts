import { NextRequest, NextResponse } from 'next/server'
import { exchangeToken } from '@21st-sdk/nextjs/server'
import { requireAuth } from '@/lib/auth/admin-guard'

const AGENT_SLUG = 'my-agent'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const apiKey = process.env.API_KEY_21ST
  if (!apiKey) {
    console.error('[an-token] API_KEY_21ST is not configured')
    return NextResponse.json({ error: 'AI assistant is not configured' }, { status: 500 })
  }

  try {
    const data = await exchangeToken({
      apiKey,
      agent: AGENT_SLUG,
      userId: profile.id,
    })

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    console.error('[an-token] token exchange failed:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { WaTemplate } from '@/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error
  if (!profile.wa_enabled) {
    return NextResponse.json({ error: 'WhatsApp is not enabled for your account' }, { status: 403 })
  }

  const rows = await withUser(profile.id, (tx) =>
    tx<WaTemplate[]>`
      SELECT t.id, t.name, t.body, t.media_id, t.is_active, t.created_by,
             t.created_at, t.updated_at,
             m.file_name AS media_file_name,
             m.mime_type AS media_mime_type,
             m.size_bytes AS media_size_bytes
      FROM wa_templates t
      LEFT JOIN wa_media m ON m.id = t.media_id
      WHERE t.is_active = true
      ORDER BY t.name
    `
  )
  return NextResponse.json(rows)
}

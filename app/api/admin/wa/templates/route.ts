import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import type { WaTemplate } from '@/types'

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const MAX_MEDIA_BYTES = 10 * 1024 * 1024

function validateTemplate(name: string, body: string): string | null {
  if (!name) return 'Name is required'
  if (name.length > 100) return 'Name must be 100 characters or fewer'
  if (!body) return 'Message body is required'
  if (body.length > 4096) return 'Message body must be 4,096 characters or fewer'
  return null
}

function validateFile(file: File | null): string | null {
  if (!file || file.size === 0) return null
  if (!ALLOWED_MEDIA.has(file.type)) return 'Only JPG, PNG, WebP, and PDF files are allowed'
  if (file.size > MAX_MEDIA_BYTES) return 'Attachment must be 10 MB or smaller'
  return null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  const rows = await withUser(profile.id, (tx) =>
    tx<WaTemplate[]>`
      SELECT t.id, t.name, t.body, t.media_id, t.is_active, t.created_by,
             t.created_at, t.updated_at,
             m.file_name AS media_file_name,
             m.mime_type AS media_mime_type,
             m.size_bytes AS media_size_bytes
      FROM wa_templates t
      LEFT JOIN wa_media m ON m.id = t.media_id
      ORDER BY t.name
    `
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const name = String(form.get('name') ?? '').trim()
  const body = String(form.get('body') ?? '').trim()
  const isActive = String(form.get('is_active') ?? 'true') !== 'false'
  const fileValue = form.get('file')
  const file = fileValue instanceof File ? fileValue : null

  const validationError = validateTemplate(name, body) ?? validateFile(file)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 })

  try {
    const [created] = await withUser(profile.id, async (tx) => {
      let mediaId: string | null = null
      if (file && file.size > 0) {
        const bytes = Buffer.from(await file.arrayBuffer())
        const [media] = await tx<{ id: string }[]>`
          INSERT INTO wa_media (file_name, mime_type, size_bytes, data, uploaded_by)
          VALUES (${file.name}, ${file.type}, ${file.size}, ${bytes}, ${profile.id}::uuid)
          RETURNING id
        `
        mediaId = media.id
      }

      return tx<WaTemplate[]>`
        INSERT INTO wa_templates (name, body, media_id, is_active, created_by)
        VALUES (${name}, ${body}, ${mediaId}::uuid, ${isActive}, ${profile.id}::uuid)
        RETURNING id, name, body, media_id, is_active, created_by, created_at, updated_at,
                  NULL::text AS media_file_name, NULL::text AS media_mime_type,
                  NULL::integer AS media_size_bytes
      `
    })

    // Return the authoritative joined shape, including attachment metadata.
    const [row] = await withUser(profile.id, (tx) =>
      tx<WaTemplate[]>`
        SELECT t.id, t.name, t.body, t.media_id, t.is_active, t.created_by,
               t.created_at, t.updated_at,
               m.file_name AS media_file_name,
               m.mime_type AS media_mime_type,
               m.size_bytes AS media_size_bytes
        FROM wa_templates t
        LEFT JOIN wa_media m ON m.id = t.media_id
        WHERE t.id = ${created.id}::uuid
      `
    )
    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
    }
    console.error('[admin/wa/templates POST] DB error:', err)
    return NextResponse.json({ error: 'Could not create template' }, { status: 500 })
  }
}

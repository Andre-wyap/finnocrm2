import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import { isUuid } from '@/lib/validation'
import type { WaTemplate } from '@/types'

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const MAX_MEDIA_BYTES = 10 * 1024 * 1024

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid template id' }, { status: 400 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const name = String(form.get('name') ?? '').trim()
  const body = String(form.get('body') ?? '').trim()
  const isActive = String(form.get('is_active') ?? 'true') !== 'false'
  const removeMedia = String(form.get('remove_media') ?? 'false') === 'true'
  const fileValue = form.get('file')
  const file = fileValue instanceof File ? fileValue : null

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 422 })
  if (name.length > 100) return NextResponse.json({ error: 'Name must be 100 characters or fewer' }, { status: 422 })
  if (!body) return NextResponse.json({ error: 'Message body is required' }, { status: 422 })
  if (body.length > 4096) return NextResponse.json({ error: 'Message body must be 4,096 characters or fewer' }, { status: 422 })
  if (file && file.size > 0 && !ALLOWED_MEDIA.has(file.type)) {
    return NextResponse.json({ error: 'Only JPG, PNG, WebP, and PDF files are allowed' }, { status: 422 })
  }
  if (file && file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json({ error: 'Attachment must be 10 MB or smaller' }, { status: 422 })
  }

  try {
    const row = await withUser(profile.id, async (tx) => {
      const [existing] = await tx<{ media_id: string | null }[]>`
        SELECT media_id FROM wa_templates WHERE id = ${id}::uuid FOR UPDATE
      `
      if (!existing) return null

      let mediaId = removeMedia ? null : existing.media_id
      if (file && file.size > 0) {
        const bytes = Buffer.from(await file.arrayBuffer())
        const [media] = await tx<{ id: string }[]>`
          INSERT INTO wa_media (file_name, mime_type, size_bytes, data, uploaded_by)
          VALUES (${file.name}, ${file.type}, ${file.size}, ${bytes}, ${profile.id}::uuid)
          RETURNING id
        `
        mediaId = media.id
      }

      await tx`
        UPDATE wa_templates
        SET name = ${name}, body = ${body}, media_id = ${mediaId}::uuid, is_active = ${isActive}
        WHERE id = ${id}::uuid
      `

      if (existing.media_id && existing.media_id !== mediaId) {
        await tx`
          DELETE FROM wa_media
          WHERE id = ${existing.media_id}::uuid
            AND NOT EXISTS (SELECT 1 FROM wa_templates WHERE media_id = ${existing.media_id}::uuid)
        `
      }

      const [updated] = await tx<WaTemplate[]>`
        SELECT t.id, t.name, t.body, t.media_id, t.is_active, t.created_by,
               t.created_at, t.updated_at,
               m.file_name AS media_file_name,
               m.mime_type AS media_mime_type,
               m.size_bytes AS media_size_bytes
        FROM wa_templates t
        LEFT JOIN wa_media m ON m.id = t.media_id
        WHERE t.id = ${id}::uuid
      `
      return updated
    })
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 })
    }
    console.error('[admin/wa/templates PATCH] DB error:', err)
    return NextResponse.json({ error: 'Could not update template' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { profile, error } = await requireAdmin(req)
  if (error) return error
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid template id' }, { status: 400 })

  try {
    const deleted = await withUser(profile.id, async (tx) => {
      const [existing] = await tx<{ media_id: string | null }[]>`
        SELECT media_id FROM wa_templates WHERE id = ${id}::uuid FOR UPDATE
      `
      if (!existing) return false
      await tx`DELETE FROM wa_templates WHERE id = ${id}::uuid`
      if (existing.media_id) {
        await tx`
          DELETE FROM wa_media
          WHERE id = ${existing.media_id}::uuid
            AND NOT EXISTS (SELECT 1 FROM wa_templates WHERE media_id = ${existing.media_id}::uuid)
        `
      }
      return true
    })
    if (!deleted) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      return NextResponse.json(
        { error: 'This template has message history and cannot be deleted. Deactivate it instead.' },
        { status: 409 }
      )
    }
    console.error('[admin/wa/templates DELETE] DB error:', err)
    return NextResponse.json({ error: 'Could not delete template' }, { status: 500 })
  }
}

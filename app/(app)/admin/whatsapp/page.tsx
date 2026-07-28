'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { WaTemplate } from '@/types'

const PLACEHOLDERS = [
  '{{full_name}}',
  '{{first_name}}',
  '{{agent_name}}',
  '{{state}}',
  '{{product_interest}}',
]

const EMPTY_FORM = { name: '', body: '', is_active: true }

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function WhatsAppAdminPage() {
  const { profile } = useAuth()
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WaTemplate | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [removeMedia, setRemoveMedia] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WaTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/admin/wa/templates')
    if (res.ok) setTemplates(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (profile?.role === 'admin') load()
  }, [profile?.role, load])

  if (profile?.role !== 'admin') {
    return (
      <div className="text-center py-24 text-text-secondary">
        You do not have permission to view this page.
      </div>
    )
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFile(null)
    setRemoveMedia(false)
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(template: WaTemplate) {
    setEditing(template)
    setForm({ name: template.name, body: template.body, is_active: template.is_active })
    setFile(null)
    setRemoveMedia(false)
    setFormError('')
    setDialogOpen(true)
  }

  function insertPlaceholder(value: string) {
    const element = textareaRef.current
    if (!element) {
      setForm((current) => ({ ...current, body: `${current.body}${value}` }))
      return
    }
    const start = element.selectionStart
    const end = element.selectionEnd
    setForm((current) => ({
      ...current,
      body: `${current.body.slice(0, start)}${value}${current.body.slice(end)}`,
    }))
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + value.length, start + value.length)
    })
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const payload = new FormData()
      payload.set('name', form.name)
      payload.set('body', form.body)
      payload.set('is_active', String(form.is_active))
      payload.set('remove_media', String(removeMedia))
      if (file) payload.set('file', file)

      const res = await apiFetch(
        editing ? `/api/admin/wa/templates/${editing.id}` : '/api/admin/wa/templates',
        { method: editing ? 'PATCH' : 'POST', body: payload }
      )
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error ?? 'Could not save template')
        return
      }
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await apiFetch(`/api/admin/wa/templates/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setDeleteError(data.error ?? 'Could not delete template')
        return
      }
      setDeleteTarget(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle size={21} className="text-teal-500" />
            <h1 className="text-2xl font-bold text-text-primary">WhatsApp Templates</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Shared messages agents can send from a lead card.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus size={15} /> New Template
        </Button>
      </div>

      {loading ? (
        <Card className="py-12 text-center text-sm text-text-secondary">Loading…</Card>
      ) : templates.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium text-text-primary">No templates yet</p>
          <p className="text-sm text-text-secondary mt-1">Create the first reusable WhatsApp message.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-text-primary truncate">{template.name}</h2>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                      template.is_active
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {template.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(template)}
                    className="p-1.5 text-text-secondary hover:text-finno-500"
                    aria-label={`Edit ${template.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => { setDeleteTarget(template); setDeleteError('') }}
                    className="p-1.5 text-text-secondary hover:text-red-500"
                    aria-label={`Delete ${template.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <p className="text-sm text-text-secondary whitespace-pre-wrap line-clamp-5">
                {template.body}
              </p>

              {template.media_file_name && (
                <div className="mt-auto flex items-center gap-2 rounded-button bg-surface-subtle px-3 py-2 text-xs text-text-secondary">
                  {template.media_mime_type === 'application/pdf'
                    ? <FileText size={15} />
                    : <ImageIcon size={15} />}
                  <span className="truncate">{template.media_file_name}</span>
                  <span className="ml-auto shrink-0">{formatBytes(template.media_size_bytes)}</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        title={editing ? 'Edit WhatsApp Template' : 'New WhatsApp Template'}
      >
        <form onSubmit={saveTemplate} className="space-y-4">
          <Input
            label="Template Name"
            value={form.name}
            maxLength={100}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. Medical Introduction"
            required
          />

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Message</label>
            <textarea
              ref={textareaRef}
              value={form.body}
              maxLength={4096}
              rows={8}
              required
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Hi {{first_name}}, I’m {{agent_name}} from FINNO…"
              className="w-full rounded-button border border-border bg-surface-base px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15 resize-y"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PLACEHOLDERS.map((placeholder) => (
                <button
                  type="button"
                  key={placeholder}
                  onClick={() => insertPlaceholder(placeholder)}
                  className="text-xs px-2 py-1 rounded-pill bg-finno-500/10 text-finno-500 hover:bg-finno-500/15"
                >
                  {placeholder}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary mt-1 text-right">{form.body.length}/4096</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Attachment <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            {editing?.media_file_name && !removeMedia && !file && (
              <div className="flex items-center gap-2 mb-2 text-sm text-text-secondary">
                <FileText size={15} />
                <span className="truncate">{editing.media_file_name}</span>
                <button
                  type="button"
                  onClick={() => setRemoveMedia(true)}
                  className="ml-auto text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                if (event.target.files?.[0]) setRemoveMedia(false)
              }}
              className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-button file:border-0 file:bg-finno-500/10 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-finno-500"
            />
            <p className="text-xs text-text-secondary mt-1">JPG, PNG, WebP, or PDF · maximum 10 MB</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
              className="rounded border-border"
            />
            Active and available to agents
          </label>

          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save Template' : 'Create Template'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Template"
      >
        <p className="text-sm text-text-secondary">
          Delete <span className="font-semibold text-text-primary">{deleteTarget?.name}</span>? Templates
          with message history cannot be deleted and should be deactivated instead.
        </p>
        {deleteError && <p className="text-sm text-red-500 mt-3">{deleteError}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button
            onClick={deleteTemplate}
            loading={deleting}
            className="bg-red-500 hover:bg-red-600 text-white border-red-500"
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/client'
import { flowDurationLabel } from '@/lib/wa/schedule'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { WaFlow, WaTemplate } from '@/types'

type DelayUnit = 'minutes' | 'hours' | 'days'
type EditableStep = {
  key: string
  template_id: string
  delay_value: number
  delay_unit: DelayUnit
}

const UNIT_MINUTES: Record<DelayUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
}

function emptyStep(templateId = ''): EditableStep {
  return {
    key: crypto.randomUUID(),
    template_id: templateId,
    delay_value: 0,
    delay_unit: 'minutes',
  }
}

function editableDelay(delayMinutes: number): Pick<EditableStep, 'delay_value' | 'delay_unit'> {
  if (delayMinutes > 0 && delayMinutes % 1440 === 0) {
    return { delay_value: delayMinutes / 1440, delay_unit: 'days' }
  }
  if (delayMinutes > 0 && delayMinutes % 60 === 0) {
    return { delay_value: delayMinutes / 60, delay_unit: 'hours' }
  }
  return { delay_value: delayMinutes, delay_unit: 'minutes' }
}

function totalDelay(flow: WaFlow): number {
  return flow.steps.reduce((total, step) => total + step.delay_minutes, 0)
}

export function FlowManager({ templates }: { templates: WaTemplate[] }) {
  const [flows, setFlows] = useState<WaFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WaFlow | null>(null)
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [steps, setSteps] = useState<EditableStep[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WaFlow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  const activeTemplates = useMemo(
    () => templates.filter((template) => template.is_active),
    [templates]
  )

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/admin/wa/flows')
    if (res.ok) setFlows(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setName('')
    setActive(true)
    setSteps([emptyStep(activeTemplates[0]?.id)])
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(flow: WaFlow) {
    setEditing(flow)
    setName(flow.name)
    setActive(flow.is_active)
    setSteps(flow.steps.map((step) => ({
      key: step.id,
      template_id: step.template_id,
      ...editableDelay(step.delay_minutes),
    })))
    setFormError('')
    setDialogOpen(true)
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= steps.length || from === to) return
    setSteps((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  async function saveFlow(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const normalizedSteps = steps.map((step) => ({
        template_id: step.template_id,
        delay_minutes: step.delay_value * UNIT_MINUTES[step.delay_unit],
      }))
      const res = await apiFetch(
        editing ? `/api/admin/wa/flows/${editing.id}` : '/api/admin/wa/flows',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, is_active: active, steps: normalizedSteps }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error ?? 'Could not save flow')
        return
      }
      setDialogOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteFlow() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await apiFetch(`/api/admin/wa/flows/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setDeleteError(data.error ?? 'Could not delete flow')
        return
      }
      setDeleteTarget(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate} disabled={activeTemplates.length === 0}>
          <Plus size={15} /> New Flow
        </Button>
      </div>

      {activeTemplates.length === 0 && (
        <Card className="p-4 text-sm text-amber-700 bg-amber-50 border-amber-200">
          Create and activate at least one template before building a flow.
        </Card>
      )}

      {loading ? (
        <Card className="py-12 text-center text-sm text-text-secondary">Loading…</Card>
      ) : flows.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="font-medium text-text-primary">No flows yet</p>
          <p className="text-sm text-text-secondary mt-1">
            Combine templates into a timed follow-up sequence.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <Card key={flow.id} className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Workflow size={16} className="text-teal-500 shrink-0" />
                    <h2 className="font-semibold text-text-primary truncate">{flow.name}</h2>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                    <span>{flow.steps.length} {flow.steps.length === 1 ? 'step' : 'steps'}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 size={13} /> {flowDurationLabel(totalDelay(flow))}
                    </span>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                  flow.is_active ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {flow.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <ol className="space-y-2">
                {flow.steps.map((step) => (
                  <li key={step.id} className="flex gap-2 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-finno-500/10 text-[11px] font-bold text-finno-500">
                      {step.step_order}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-text-primary">{step.template_name}</span>
                      <span className="text-xs text-text-secondary">
                        {step.delay_minutes === 0
                          ? 'Send immediately'
                          : `Wait ${flowDurationLabel(step.delay_minutes)}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex justify-end gap-1 border-t border-border pt-3">
                <button
                  onClick={() => openEdit(flow)}
                  className="p-1.5 text-text-secondary hover:text-finno-500"
                  aria-label={`Edit ${flow.name}`}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => { setDeleteTarget(flow); setDeleteError('') }}
                  className="p-1.5 text-text-secondary hover:text-red-500"
                  aria-label={`Delete ${flow.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        title={editing ? 'Edit WhatsApp Flow' : 'New WhatsApp Flow'}
        className="max-w-2xl"
      >
        <form onSubmit={saveFlow} className="space-y-5">
          <Input
            label="Flow Name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. New Lead Follow-up"
            required
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-text-primary">Steps</label>
              <button
                type="button"
                onClick={() => setSteps((current) => [...current, emptyStep(activeTemplates[0]?.id)])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-finno-500 hover:underline"
              >
                <Plus size={13} /> Add step
              </button>
            </div>
            <div className="space-y-3">
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  draggable
                  onDragStart={() => setDraggedIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggedIndex !== null) moveStep(draggedIndex, index)
                    setDraggedIndex(null)
                  }}
                  onDragEnd={() => setDraggedIndex(null)}
                  className={`rounded-card border border-border bg-surface-subtle p-3 ${
                    draggedIndex === index ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <GripVertical size={16} className="cursor-grab text-text-secondary" />
                    <span className="text-sm font-semibold text-text-primary">Step {index + 1}</span>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveStep(index, index - 1)}
                        disabled={index === 0}
                        className="p-1 text-text-secondary hover:text-finno-500 disabled:opacity-30"
                        aria-label={`Move step ${index + 1} up`}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(index, index + 1)}
                        disabled={index === steps.length - 1}
                        className="p-1 text-text-secondary hover:text-finno-500 disabled:opacity-30"
                        aria-label={`Move step ${index + 1} down`}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        disabled={steps.length === 1}
                        className="p-1 text-text-secondary hover:text-red-500 disabled:opacity-30"
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_110px]">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Template</label>
                      <select
                        value={step.template_id}
                        required
                        onChange={(event) => setSteps((current) => current.map((item) =>
                          item.key === step.key ? { ...item, template_id: event.target.value } : item
                        ))}
                        className="h-10 w-full rounded-button border border-border bg-surface-base px-3 text-sm text-text-primary focus:outline-none focus:border-finno-500"
                      >
                        <option value="">Select template</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id} disabled={!template.is_active}>
                            {template.name}{template.is_active ? '' : ' (inactive)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Input
                      label="Wait"
                      type="number"
                      min={0}
                      max={525600}
                      step={1}
                      value={step.delay_value}
                      onChange={(event) => setSteps((current) => current.map((item) =>
                        item.key === step.key
                          ? { ...item, delay_value: Number(event.target.value) }
                          : item
                      ))}
                      required
                      className="h-10"
                    />
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Unit</label>
                      <select
                        value={step.delay_unit}
                        onChange={(event) => setSteps((current) => current.map((item) =>
                          item.key === step.key
                            ? { ...item, delay_unit: event.target.value as DelayUnit }
                            : item
                        ))}
                        className="h-10 w-full rounded-button border border-border bg-surface-base px-3 text-sm text-text-primary focus:outline-none focus:border-finno-500"
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
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
              {editing ? 'Save Flow' : 'Create Flow'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Flow"
      >
        <p className="text-sm text-text-secondary">
          Delete <span className="font-semibold text-text-primary">{deleteTarget?.name}</span>? Flows
          with run history cannot be deleted and should be deactivated instead.
        </p>
        {deleteError && <p className="text-sm text-red-500 mt-3">{deleteError}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button
            onClick={deleteFlow}
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

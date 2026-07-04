'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { StatusBadge } from '@/components/ui/badge'
import {
  AlertTriangle, ArrowLeft, MessageCircle, MessageSquare, Phone,
  ArrowRight, Edit2, UserCheck, Send, Archive, ArchiveRestore,
} from 'lucide-react'
import type { LeadStatus, ActivityType } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

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
  possible_duplicate: boolean
  created_at: string
  updated_at: string
  agent_name: string | null
  assigned_by_name: string | null
}

type ActivityRow = {
  id: string
  type: ActivityType
  content: string | null
  field_name: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
  actor_name: string | null
}

type AssignableUser = {
  id: string
  full_name: string
  role: string
  team_id: string | null
  team_name: string | null
}

type FormDraft = {
  full_name: string
  date_of_birth: string
  gender: string
  smoking_status: string
  mobile: string
  email: string
  state: string
  product_interest: string[]
  case_size: string
  status: LeadStatus
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUCTS = [
  { value: 'medical', label: 'Medical' },
  { value: 'critical_illness', label: 'Critical Illness' },
  { value: 'life', label: 'Life' },
  { value: 'personal_accident', label: 'Personal Accident' },
]

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name',
  date_of_birth: 'Date of Birth',
  gender: 'Gender',
  smoking_status: 'Smoking Status',
  mobile: 'Mobile',
  email: 'Email',
  state: 'State',
  case_size: 'Case Size',
  status: 'Status',
  product_interest: 'Product Interest',
}

const QUICK_REMARKS = [
  'No pick up',
  'Already whatsapp',
  'Appointment set',
  'Not health',
  'General remark',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatActivityTime(ts: string): string {
  const date = new Date(ts)
  const datePart = date.toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const timePart = date.toLocaleTimeString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${datePart}, ${timePart}`
}

function formatCreatedAt(ts: string): string {
  return new Date(ts).toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function leadToDraft(lead: LeadDetail): FormDraft {
  return {
    full_name: lead.full_name,
    date_of_birth: lead.date_of_birth ?? '',
    gender: lead.gender ?? '',
    smoking_status: lead.smoking_status ?? '',
    mobile: lead.mobile,
    email: lead.email ?? '',
    state: lead.state ?? '',
    product_interest: lead.product_interest ?? ['medical'],
    case_size: lead.case_size !== null ? String(lead.case_size) : '',
    status: lead.status,
  }
}

function whatsappUrl(mobile: string): string | null {
  const trimmed = mobile.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  const normalized = digits.startsWith('0') ? `60${digits.slice(1)}` : digits
  return `https://wa.me/${normalized}`
}

// ── Activity icon ─────────────────────────────────────────────────────────────

function ActivityIcon({ type }: { type: ActivityType }) {
  const icon: Record<ActivityType, React.ReactNode> = {
    remark:        <MessageSquare size={14} />,
    call:          <Phone size={14} />,
    status_change: <ArrowRight size={14} />,
    field_change:  <Edit2 size={14} />,
    assignment:    <UserCheck size={14} />,
    archive:       <Archive size={14} />,
    restore:       <ArchiveRestore size={14} />,
  }
  const bg: Record<ActivityType, string> = {
    remark:        'bg-blue-100 text-blue-600',
    call:          'bg-teal-100 text-teal-600',
    status_change: 'bg-violet-100 text-violet-600',
    field_change:  'bg-gray-100 text-gray-500',
    assignment:    'bg-finno-500/10 text-finno-500',
    archive:       'bg-amber-100 text-amber-600',
    restore:       'bg-green-100 text-green-600',
  }
  return (
    <span className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${bg[type]}`}>
      {icon[type]}
    </span>
  )
}

function ActivityContent({ activity }: { activity: ActivityRow }) {
  if (activity.type === 'field_change') {
    const label = FIELD_LABELS[activity.field_name ?? ''] ?? activity.field_name ?? 'Field'
    return (
      <p className="text-sm text-text-secondary">
        <span className="font-medium text-text-primary">{label}</span>
        {': '}
        <span className="line-through opacity-60">{activity.old_value || '—'}</span>
        {' → '}
        <span>{activity.new_value || '—'}</span>
      </p>
    )
  }
  if (activity.type === 'status_change') {
    return (
      <p className="text-sm text-text-secondary">
        Status changed from{' '}
        <span className="font-medium">{activity.old_value}</span>
        {' → '}
        <span className="font-medium">{activity.new_value}</span>
      </p>
    )
  }
  return (
    <p className="text-sm text-text-secondary">
      {activity.content || '—'}
    </p>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { profile } = useAuth()

  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [quickRemark, setQuickRemark] = useState('')
  const [remarkText, setRemarkText] = useState('')
  const [remarkSubmitting, setRemarkSubmitting] = useState(false)
  const [agents, setAgents] = useState<AssignableUser[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [lostConfirm, setLostConfirm] = useState(false)
  const [markingLost, setMarkingLost] = useState(false)
  const [dismissingDuplicate, setDismissingDuplicate] = useState(false)
  const remarkRef = useRef<HTMLTextAreaElement>(null)

  const isAdminOrSubadmin = profile?.role === 'admin' || profile?.role === 'subadmin'

  const loadActivities = useCallback(async () => {
    const res = await apiFetch(`/api/leads/${id}/activities`)
    if (res.ok) setActivities(await res.json())
  }, [id])

  const loadLead = useCallback(async () => {
    const res = await apiFetch(`/api/leads/${id}`)
    if (res.status === 404) { setNotFound(true); setLoading(false); return }
    if (!res.ok) { setLoading(false); return }
    const data: LeadDetail = await res.json()
    setLead(data)
    setDraft(leadToDraft(data))
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadLead()
    loadActivities()
  }, [loadLead, loadActivities])

  useEffect(() => {
    if (!isAdminOrSubadmin) return
    apiFetch('/api/agents')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {})
  }, [isAdminOrSubadmin])

  function setField<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((d) => d ? { ...d, [key]: value } : d)
    setDirty(true)
  }

  function toggleProduct(product: string) {
    setDraft((d) => {
      if (!d) return d
      const has = d.product_interest.includes(product)
      const next = has
        ? d.product_interest.filter((p) => p !== product)
        : [...d.product_interest, product]
      return { ...d, product_interest: next.length > 0 ? next : d.product_interest }
    })
    setDirty(true)
  }

  function handleDiscard() {
    if (lead) { setDraft(leadToDraft(lead)); setDirty(false); setSaveError('') }
  }

  async function handleSave() {
    if (!draft) return
    if (!draft.full_name.trim()) { setSaveError('Full name is required'); return }
    if (!draft.mobile.trim()) { setSaveError('Mobile is required'); return }
    setSaving(true)
    setSaveError('')
    try {
      const body: Record<string, unknown> = {
        full_name: draft.full_name,
        date_of_birth: draft.date_of_birth || null,
        gender: draft.gender || null,
        smoking_status: draft.smoking_status || null,
        mobile: draft.mobile,
        email: draft.email || null,
        state: draft.state || null,
        case_size: draft.case_size ? parseFloat(draft.case_size) : null,
        status: draft.status,
        product_interest: draft.product_interest,
      }
      const res = await apiFetch(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) {
        const data = await res.json()
        setSaveError(data.error ?? 'Failed to save')
        return
      }
      setDirty(false)
      await loadLead()
      await loadActivities()
    } finally {
      setSaving(false)
    }
  }

  async function handleAddRemark() {
    const content = remarkText.trim()
    const quick = quickRemark.trim()
    const remarkContent = [quick, content].filter(Boolean).join(': ')
    if (!remarkContent) return
    setRemarkSubmitting(true)
    try {
      const res = await apiFetch(`/api/leads/${id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ content: remarkContent }),
      })
      if (res.ok) {
        setQuickRemark('')
        setRemarkText('')
        await loadActivities()
        remarkRef.current?.focus()
      }
    } finally {
      setRemarkSubmitting(false)
    }
  }

  async function handleAssign() {
    if (!selectedAgentId) return
    setAssigning(true)
    setAssignError('')
    try {
      const res = await apiFetch(`/api/leads/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ agent_id: selectedAgentId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setAssignError(data.error ?? 'Assignment failed')
        return
      }
      setSelectedAgentId('')
      await loadLead()
      await loadActivities()
    } finally {
      setAssigning(false)
    }
  }

  async function handleMarkAsLost() {
    setMarkingLost(true)
    try {
      const res = await apiFetch(`/api/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'lost' }),
      })
      if (res.ok) {
        setLostConfirm(false)
        setDirty(false)
        await loadLead()
        await loadActivities()
      }
    } finally {
      setMarkingLost(false)
    }
  }

  async function handleDismissDuplicate() {
    setDismissingDuplicate(true)
    try {
      const res = await apiFetch(`/api/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ possible_duplicate: false }),
      })
      if (res.ok) await loadLead()
    } finally {
      setDismissingDuplicate(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="py-24 text-center text-text-secondary text-sm">Loading…</div>
    )
  }
  if (notFound || !lead || !draft) {
    return (
      <div className="py-24 text-center text-text-secondary text-sm">
        Lead not found or you do not have access.{' '}
        <button onClick={() => router.push('/')} className="text-finno-500 hover:underline">
          Back to Leads
        </button>
      </div>
    )
  }

  const leadWhatsappUrl = whatsappUrl(lead.mobile)

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start gap-3 mb-6 flex-wrap">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mt-0.5 shrink-0"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{lead.full_name}</h1>
            <StatusBadge status={lead.status} />
            {lead.possible_duplicate && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                <AlertTriangle size={13} /> Possible duplicate
                <button
                  onClick={handleDismissDuplicate}
                  disabled={dismissingDuplicate}
                  className="underline hover:no-underline text-amber-500 hover:text-amber-700 transition-colors disabled:opacity-50"
                >
                  {dismissingDuplicate ? 'Dismissing…' : 'Dismiss'}
                </button>
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Source: <span className="font-medium">{lead.source}</span>
            {' · '}
            Created: {formatCreatedAt(lead.created_at)}
          </p>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── Left: Customer info ─────────────────────────────────────────── */}
        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Customer Information
          </h2>

          <Input
            label="Full Name"
            value={draft.full_name}
            onChange={(e) => setField('full_name', e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date of Birth"
              type="date"
              value={draft.date_of_birth}
              onChange={(e) => setField('date_of_birth', e.target.value)}
            />
            <Select
              label="Gender"
              value={draft.gender}
              onChange={(e) => setField('gender', e.target.value)}
            >
              <option value="">— Select —</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
          </div>

          <Select
            label="Smoking Status"
            value={draft.smoking_status}
            onChange={(e) => setField('smoking_status', e.target.value)}
          >
            <option value="">— Select —</option>
            <option value="non_smoker">Non-Smoker</option>
            <option value="smoker">Smoker</option>
          </Select>

          <Input
            label="Mobile"
            type="tel"
            value={draft.mobile}
            onChange={(e) => setField('mobile', e.target.value)}
            required
          />

          {leadWhatsappUrl && (
            <a
              href={leadWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-button bg-teal-500 px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-teal-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
          )}

          <Input
            label="Email"
            type="email"
            value={draft.email}
            onChange={(e) => setField('email', e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="State"
              value={draft.state}
              onChange={(e) => setField('state', e.target.value)}
              placeholder="e.g. Selangor"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">Case Size (RM)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary pointer-events-none">
                  RM
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.case_size}
                  onChange={(e) => setField('case_size', e.target.value)}
                  className="h-11 w-full rounded-button border border-border bg-surface-base pl-10 pr-3 text-sm text-text-primary focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Product interest */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text-primary">Product Interest</span>
            <div className="grid grid-cols-2 gap-2">
              {PRODUCTS.map((p) => {
                const checked = draft.product_interest.includes(p.value)
                return (
                  <label
                    key={p.value}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-button border cursor-pointer transition-colors text-sm select-none ${
                      checked
                        ? 'border-finno-500 bg-finno-500/5 text-finno-500 font-medium'
                        : 'border-border text-text-secondary hover:border-finno-500/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProduct(p.value)}
                      className="accent-finno-500"
                    />
                    {p.label}
                  </label>
                )
              })}
            </div>
          </div>

          <Select
            label="Status"
            value={draft.status}
            onChange={(e) => setField('status', e.target.value as LeadStatus)}
          >
            <option value="unassigned">Unassigned</option>
            <option value="lead">Lead</option>
            <option value="follow_up">Follow-up</option>
            <option value="potential">Potential</option>
            <option value="closed">Closed</option>
            <option value="issued">Issued</option>
            <option value="lost">Lost</option>
          </Select>

          {/* Read-only fields */}
          <div className="pt-2 border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Source</span>
              <span className="font-medium text-text-primary">{lead.source}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Assigned Agent</span>
              <span className="font-medium text-text-primary">
                {lead.agent_name ?? <span className="italic text-text-secondary">Unassigned</span>}
              </span>
            </div>
            {lead.assigned_at && (
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Assigned On</span>
                <span className="text-text-primary">{formatCreatedAt(lead.assigned_at)}</span>
              </div>
            )}
          </div>

          {/* Assign / Reassign section — admin/subadmin */}
          {isAdminOrSubadmin && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {lead.status === 'unassigned' ? 'Assign Lead' : 'Reassign Lead'}
              </p>
              <div className="flex gap-2">
                <Select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">Select user…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}{a.team_name ? ` (${a.team_name})` : ''}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  onClick={handleAssign}
                  disabled={!selectedAgentId || selectedAgentId === lead.assigned_agent_id}
                  loading={assigning}
                >
                  {lead.status === 'unassigned' ? 'Assign' : 'Reassign'}
                </Button>
              </div>
              {assignError && <p className="text-xs text-red-500">{assignError}</p>}
            </div>
          )}

          {/* Save / Discard */}
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          {dirty && (
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} loading={saving} className="flex-1">
                Save Changes
              </Button>
              <Button variant="ghost" onClick={handleDiscard} disabled={saving}>
                Discard
              </Button>
            </div>
          )}

          {/* Mark as Lost */}
          {lead.status !== 'lost' && (
            <div className="pt-3 border-t border-border">
              {lostConfirm ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm text-text-secondary flex-1">Mark this lead as lost?</p>
                  <Button
                    size="sm"
                    onClick={handleMarkAsLost}
                    loading={markingLost}
                    className="bg-red-500 hover:bg-red-600 text-white border-red-500"
                  >
                    Confirm Lost
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLostConfirm(false)}
                    disabled={markingLost}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setLostConfirm(true)}
                  className="text-sm text-text-secondary hover:text-red-500 transition-colors"
                >
                  Mark as Lost
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Activity feed ────────────────────────────────────────── */}
        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-6 flex flex-col gap-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Activity History
          </h2>

          {/* Add remark */}
          <div className="space-y-2">
            <Select
              label="Quick remark"
              value={quickRemark}
              onChange={(e) => setQuickRemark(e.target.value)}
            >
              <option value="">Select quick remark…</option>
              {QUICK_REMARKS.map((remark) => (
                <option key={remark} value={remark}>{remark}</option>
              ))}
            </Select>
            <textarea
              ref={remarkRef}
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddRemark()
              }}
              placeholder="Add a remark… (⌘ Enter to submit)"
              rows={3}
              className="w-full rounded-button border border-border bg-surface-base px-3 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15 resize-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddRemark}
              disabled={!quickRemark.trim() && !remarkText.trim()}
              loading={remarkSubmitting}
              className="flex items-center gap-1.5"
            >
              <Send size={13} /> Add Remark
            </Button>
          </div>

          {/* Feed */}
          {activities.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-6">No activity yet.</p>
          ) : (
            <ul className="space-y-4">
              {activities.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <ActivityIcon type={a.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-text-primary truncate">
                        {a.actor_name ?? '—'}
                      </span>
                      <span className="text-xs text-text-secondary shrink-0">
                        {formatActivityTime(a.created_at)}
                      </span>
                    </div>
                    <ActivityContent activity={a} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

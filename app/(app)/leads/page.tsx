'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { STATUS_LABELS, STATUS_STYLES } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  BulkFlowAction,
  bulkFlowOutcomeMessage,
  type BulkFlowOutcome,
} from '@/components/wa/BulkFlowAction'
import { AlertTriangle, ClipboardList, Search, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setLeadNav } from '@/lib/lead-nav'
import { insuranceAge } from '@/lib/age'
import type { LeadStatus } from '@/types'

type LeadRow = {
  id: string
  full_name: string
  status: LeadStatus
  possible_duplicate: boolean
  mobile: string | null
  source: string | null
  date_of_birth: string | null
  agent_id: string | null
  agent_name: string | null
  highlighted_remark: string | null
}

const VIEW_KEY = 'finno:leadsView'

// Spreadsheet cell styling. Borders live on the cells (not the table) because
// border-collapse breaks the sticky columns' right edge.
const TH =
  'sticky top-0 z-20 bg-surface-subtle px-3 py-2.5 text-left text-xs font-semibold ' +
  'uppercase tracking-wide text-text-secondary border-b border-r border-border whitespace-nowrap'

const TD = 'px-3 py-2 border-b border-r border-border/60 whitespace-nowrap'

// Sticky columns need their own background or rows scroll underneath them, and
// they have to repeat the row's hover/selected tint to stay visually attached.
const STICKY_CELL = (selected: boolean) =>
  cn(
    'sticky z-10',
    selected ? 'bg-[#f4f7fc]' : 'bg-surface-base group-hover:bg-surface-subtle'
  )

// Cells are edited in place. Committing on blur (and on Enter) rather than on
// every keystroke keeps this to one PATCH per edit; Escape abandons the edit.
function TextCell({
  value, onCommit, type = 'text', saving, align = 'left', mono, placeholder,
}: {
  value: string | null
  onCommit: (next: string) => void
  type?: 'text' | 'date'
  saving?: boolean
  align?: 'left' | 'right'
  mono?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [editing, setEditing] = useState(false)

  // Re-sync when the row's value changes underneath us (save, revert, refetch),
  // but never while the user is mid-edit or we'd clobber their typing.
  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  return (
    <input
      type={type}
      value={draft}
      placeholder={placeholder}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false)
        if (draft !== (value ?? '')) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); e.currentTarget.blur() }
      }}
      className={cn(
        'w-full bg-transparent px-1.5 py-1 rounded-button border border-transparent',
        'text-sm text-text-primary transition-colors',
        'hover:border-border focus:outline-none focus:border-finno-500 focus:bg-surface-base',
        'focus:ring-3 focus:ring-finno-500/15 disabled:opacity-50',
        align === 'right' && 'text-right',
        mono && 'font-mono text-xs'
      )}
    />
  )
}

function SelectCell({
  value, options, onCommit, saving, className, placeholder,
}: {
  value: string
  options: { value: string; label: string }[]
  onCommit: (next: string) => void
  saving?: boolean
  className?: string
  placeholder?: string
}) {
  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => onCommit(e.target.value)}
      className={cn(
        'w-full max-w-full cursor-pointer appearance-none bg-transparent px-1.5 py-1',
        'rounded-button border border-transparent text-sm transition-colors',
        'hover:border-border focus:outline-none focus:border-finno-500',
        'focus:ring-3 focus:ring-finno-500/15 disabled:opacity-50',
        className
      )}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface-base text-text-primary">
          {o.label}
        </option>
      ))}
    </select>
  )
}

const STATUS_CELL_OPTS = (Object.keys(STATUS_LABELS) as LeadStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABELS[v],
}))

function Empty({ label = '—' }: { label?: string }) {
  return <span className="text-border">{label}</span>
}

type AssignableUser = {
  id: string
  full_name: string
  team_name: string | null
}

type TeamOption = {
  id: string
  name: string
}

const STATUS_OPTS = [
  { value: '',           label: 'All Statuses' },
  { value: 'lead',       label: 'Lead' },
  { value: 'approach',   label: 'Approach' },
  { value: 'follow_up',  label: 'Follow-up' },
  { value: 'potential',  label: 'Potential' },
  { value: 'closed',     label: 'Closed' },
  { value: 'issued',     label: 'Issued' },
  { value: 'lost',       label: 'Lost' },
]

const PRODUCT_OPTS = [
  { value: '',                  label: 'All Products' },
  { value: 'medical',           label: 'Medical' },
  { value: 'critical_illness',  label: 'Critical Illness' },
  { value: 'life',              label: 'Life' },
  { value: 'personal_accident', label: 'Personal Accident' },
]

const LIMIT = 50

export default function LeadsPage() {
  const router = useRouter()
  const { profile } = useAuth()
  // team_leader can access the page (RLS locks their view to their own team
  // already); the team filter itself is admin/subadmin-only below, since a
  // team_leader has nothing to filter — they only ever see one team.
  const canAccessPage =
    profile?.role === 'admin' || profile?.role === 'subadmin' || profile?.role === 'team_leader'
  const canFilterByTeam = profile?.role === 'admin' || profile?.role === 'subadmin'

  const [leads,   setLeads]   = useState<LeadRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset,  setOffset]  = useState(0)

  // 'all' = every lead the viewer is allowed to see; 'mine' = only leads
  // assigned to the current user (a cleaner, focused view).
  // Persisted so returning from a lead card (Back) lands on the same tab.
  const [view,          setView]          = useState<'all' | 'mine'>('all')
  // Free-text search over name / mobile / email, debounced before it hits the API.
  const [search,        setSearch]        = useState('')
  const [searchQuery,   setSearchQuery]   = useState('')
  const [statusFilter,  setStatusFilter]  = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [agentFilter,   setAgentFilter]   = useState('')
  const [teamFilter,    setTeamFilter]    = useState('')

  const [users, setUsers] = useState<AssignableUser[]>([])
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([])

  // Bulk selection
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkAgent,     setBulkAgent]     = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkMsg,       setBulkMsg]       = useState('')
  const [bulkFlowMsg,   setBulkFlowMsg]   = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)

  const allSelected  = leads.length > 0 && selectedIds.size === leads.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  // Restore the last-used tab on mount (e.g. after Back from a lead card).
  useEffect(() => {
    const saved = sessionStorage.getItem(VIEW_KEY)
    if (saved === 'mine' || saved === 'all') setView(saved)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  function selectView(next: 'all' | 'mine') {
    setView(next)
    setSelectedIds(new Set())
    try { sessionStorage.setItem(VIEW_KEY, next) } catch { /* ignore */ }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Inline editing: one in-flight save per cell, keyed `${leadId}:${field}`.
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  const [editError,   setEditError]   = useState('')

  function markSaving(key: string, on: boolean) {
    setSavingCells((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function patchRow(id: string, patch: Partial<LeadRow>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  // Applies the change optimistically, then reverts it if the server says no.
  async function saveField(lead: LeadRow, field: keyof LeadRow, value: string | null) {
    const key = `${lead.id}:${field}`
    const previous = lead[field]
    if (value === previous) return

    setEditError('')
    patchRow(lead.id, { [field]: value } as Partial<LeadRow>)
    markSaving(key, true)
    try {
      const res = await apiFetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: '' }))
        patchRow(lead.id, { [field]: previous } as Partial<LeadRow>)
        setEditError(error || `Could not save ${String(field).replace(/_/g, ' ')}.`)
      }
    } catch {
      patchRow(lead.id, { [field]: previous } as Partial<LeadRow>)
      setEditError('Could not reach the server. Your change was not saved.')
    } finally {
      markSaving(key, false)
    }
  }

  // Assignment is its own endpoint — it stamps the owning team and logs an
  // `assignment` activity, and flips an unassigned lead to `lead`.
  async function saveAssignment(lead: LeadRow, agentId: string) {
    if (agentId === lead.agent_id) return
    const key = `${lead.id}:agent`
    const previous = { agent_id: lead.agent_id, agent_name: lead.agent_name, status: lead.status }
    const target = users.find((u) => u.id === agentId)

    setEditError('')
    patchRow(lead.id, {
      agent_id: agentId,
      agent_name: target?.full_name ?? null,
      status: lead.status === 'unassigned' ? 'lead' : lead.status,
    })
    markSaving(key, true)
    try {
      const res = await apiFetch(`/api/leads/${lead.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: '' }))
        patchRow(lead.id, previous)
        setEditError(error || 'Could not reassign this lead.')
      }
    } catch {
      patchRow(lead.id, previous)
      setEditError('Could not reach the server. Your change was not saved.')
    } finally {
      markSaving(key, false)
    }
  }

  function openLead(id: string) {
    setLeadNav({ ids: leads.map((l) => l.id), returnTo: '/leads' })
    router.push(`/leads/${id}`)
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(leads.map((l) => l.id)))
  }

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    // In "My Leads" the assignee is forced to the current user, and the agent /
    // team filters are hidden (they'd be redundant), so ignore them here.
    const effectiveAgent = view === 'mine' ? (profile?.id ?? '') : agentFilter
    const effectiveTeam  = view === 'mine' ? '' : teamFilter
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) })
    if (searchQuery)    params.set('q',       searchQuery)
    if (statusFilter)   params.set('status',  statusFilter)
    if (productFilter)  params.set('product', productFilter)
    if (effectiveAgent) params.set('agent',   effectiveAgent)
    if (effectiveTeam)  params.set('team',    effectiveTeam)
    const res  = await apiFetch(`/api/leads?${params}`)
    const data = await res.json()
    if (res.ok) {
      setLeads(off === 0 ? data.leads : (prev: LeadRow[]) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [view, profile?.id, searchQuery, statusFilter, productFilter, agentFilter, teamFilter])

  useEffect(() => {
    if (profile && !canAccessPage) { router.replace('/'); return }
    load(0)
    setSelectedIds(new Set())
  }, [profile, canAccessPage, load, router])

  useEffect(() => {
    if (!canAccessPage) return
    apiFetch('/api/agents').then((r) => r.json()).then(setUsers).catch(() => {})
  }, [canAccessPage])

  useEffect(() => {
    if (!canFilterByTeam) return
    apiFetch('/api/teams').then((r) => r.json()).then(setTeamOptions).catch(() => {})
  }, [canFilterByTeam])

  async function handleBulkAssign() {
    if (!bulkAgent || selectedIds.size === 0) return
    setBulkAssigning(true)
    setBulkMsg('')
    try {
      const res = await apiFetch('/api/leads/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: Array.from(selectedIds), agent_id: bulkAgent }),
      })
      if (res.ok) {
        const { assigned, skipped } = await res.json()
        setSelectedIds(new Set())
        setBulkAgent('')
        await load(0)
        if (skipped > 0) setBulkMsg(`${assigned} reassigned, ${skipped} skipped.`)
      }
    } finally {
      setBulkAssigning(false)
    }
  }

  function handleBulkFlowComplete(outcome: BulkFlowOutcome) {
    setBulkFlowMsg(bulkFlowOutcomeMessage(outcome))
    setSelectedIds(new Set(outcome.skipped.map((item) => item.lead_id)))
  }

  if (!canAccessPage) return null

  const hasFilters =
    search || statusFilter || productFilter || (view === 'all' && (agentFilter || teamFilter))

  return (
    <div className="space-y-5">
      {/* Header + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ClipboardList size={20} className="text-finno-500 shrink-0" />
          <h1 className="text-2xl font-bold text-text-primary">Leads</h1>
          {!loading && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill text-sm font-semibold bg-finno-500/10 text-finno-500">
              {total}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, mobile, email"
              aria-label="Search leads"
              className="h-9 text-xs w-56 pl-8 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 text-xs w-32"
          >
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="h-9 text-xs w-36"
          >
            {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {view === 'all' && (
            <Select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="h-9 text-xs w-40"
            >
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}{u.team_name ? ` (${u.team_name})` : ''}
                </option>
              ))}
            </Select>
          )}
          {view === 'all' && canFilterByTeam && (
            <Select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="h-9 text-xs w-36"
            >
              <option value="">All Teams</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); setProductFilter(''); setAgentFilter(''); setTeamFilter('') }}
              className="text-xs text-finno-500 hover:underline shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* View tabs — All Leads vs My Leads */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: 'all',  label: 'All Leads' },
          { key: 'mine', label: 'My Leads' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => selectView(tab.key)}
            className={cn(
              '-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors',
              view === tab.key
                ? 'border-finno-500 text-finno-500'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bulk assign bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-finno-500/5 border border-finno-500/20 rounded-card">
          <span className="text-sm font-semibold text-finno-500 shrink-0">
            {selectedIds.size} selected
          </span>
          <Select
            value={bulkAgent}
            onChange={(e) => setBulkAgent(e.target.value)}
            className="h-9 text-xs w-44"
          >
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}{u.team_name ? ` (${u.team_name})` : ''}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={handleBulkAssign}
            disabled={!bulkAgent}
            loading={bulkAssigning}
          >
            Reassign Selected
          </Button>
          <BulkFlowAction
            leadIds={Array.from(selectedIds)}
            onComplete={handleBulkFlowComplete}
          />
          <button
            type="button"
            className="text-sm text-text-secondary hover:text-text-primary shrink-0"
            onClick={() => {
              setSelectedIds(new Set())
              setBulkMsg('')
              setBulkFlowMsg('')
            }}
          >
            Clear
          </button>
          {bulkMsg && <p className="text-xs text-text-secondary">{bulkMsg}</p>}
        </div>
      )}
      {bulkFlowMsg && (
        <p className="rounded-button border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          {bulkFlowMsg}
        </p>
      )}

      {editError && (
        <div className="flex items-start gap-2 rounded-button border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="min-w-0 flex-1">{editError}</span>
          <button
            type="button"
            onClick={() => setEditError('')}
            className="shrink-0 font-semibold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Leads grid — spreadsheet view */}
      <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">
            No leads found.{hasFilters ? ' Try clearing the search or filters.' : ''}
          </div>
        ) : (
          <>
            {/* The pane scrolls in both directions: the header row stays pinned
                on vertical scroll, the checkbox + name columns on horizontal. */}
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={cn(TH, 'sticky left-0 z-30 w-10 px-3')}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                        className="accent-finno-500 w-4 h-4 cursor-pointer align-middle"
                      />
                    </th>
                    <th className={cn(TH, 'sticky left-10 z-30 min-w-[13rem]')}>Name</th>
                    <th className={cn(TH, 'min-w-[9rem]')}>Mobile</th>
                    <th className={cn(TH, 'min-w-[7.5rem]')}>Date of Birth</th>
                    <th className={cn(TH, 'w-16 text-right')}>Age</th>
                    <th className={cn(TH, 'min-w-[7rem]')}>Status</th>
                    <th className={cn(TH, 'min-w-[9rem]')}>Assigned To</th>
                    <th className={cn(TH, 'min-w-[8rem]')}>Source</th>
                    <th className={cn(TH, 'min-w-[14rem]')}>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const selected = selectedIds.has(lead.id)
                    const age = lead.date_of_birth ? insuranceAge(lead.date_of_birth) : null
                    return (
                      <tr
                        key={lead.id}
                        className={cn(
                          'group transition-colors',
                          selected ? 'bg-finno-500/5' : 'hover:bg-surface-subtle'
                        )}
                      >
                        <td className={cn(TD, STICKY_CELL(selected), 'left-0 px-3')}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(lead.id)}
                            aria-label={`Select ${lead.full_name}`}
                            className="accent-finno-500 w-4 h-4 cursor-pointer align-middle"
                          />
                        </td>
                        {/* Name is the only cell that navigates — everything else
                            to its right is edited in place. */}
                        <td className={cn(TD, STICKY_CELL(selected), 'left-10')}>
                          <button
                            onClick={() => openLead(lead.id)}
                            title={`Open ${lead.full_name}`}
                            className={cn(
                              'flex items-center gap-1.5 max-w-[16rem] text-left font-semibold',
                              'text-finno-500 hover:underline rounded-button px-1 -mx-1',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-finno-500/40'
                            )}
                          >
                            {lead.possible_duplicate && (
                              <AlertTriangle
                                size={13}
                                className="shrink-0 text-amber-500"
                                aria-label="Possible duplicate"
                              />
                            )}
                            <span className="truncate">{lead.full_name}</span>
                          </button>
                        </td>
                        <td className={TD}>
                          <TextCell
                            value={lead.mobile}
                            mono
                            placeholder="—"
                            saving={savingCells.has(`${lead.id}:mobile`)}
                            onCommit={(next) => {
                              const trimmed = next.trim()
                              if (!trimmed) {
                                setEditError('Mobile cannot be empty.')
                                patchRow(lead.id, { mobile: lead.mobile })
                                return
                              }
                              saveField(lead, 'mobile', trimmed)
                            }}
                          />
                        </td>
                        <td className={TD}>
                          <TextCell
                            type="date"
                            value={lead.date_of_birth ? lead.date_of_birth.slice(0, 10) : ''}
                            saving={savingCells.has(`${lead.id}:date_of_birth`)}
                            onCommit={(next) => saveField(lead, 'date_of_birth', next || null)}
                          />
                        </td>
                        <td className={cn(TD, 'text-right tabular-nums text-text-secondary')}>
                          {age ?? <Empty />}
                        </td>
                        <td className={TD}>
                          <SelectCell
                            value={lead.status}
                            options={STATUS_CELL_OPTS}
                            saving={savingCells.has(`${lead.id}:status`)}
                            onCommit={(next) => saveField(lead, 'status', next)}
                            className={cn('font-semibold rounded-pill', STATUS_STYLES[lead.status])}
                          />
                        </td>
                        <td className={TD}>
                          <SelectCell
                            value={lead.agent_id ?? ''}
                            placeholder="unassigned"
                            options={users.map((u) => ({
                              value: u.id,
                              label: u.team_name ? `${u.full_name} (${u.team_name})` : u.full_name,
                            }))}
                            saving={savingCells.has(`${lead.id}:agent`)}
                            onCommit={(next) => saveAssignment(lead, next)}
                            className={lead.agent_id ? 'text-text-secondary' : 'text-border italic'}
                          />
                        </td>
                        <td className={cn(TD, 'text-text-secondary')}>
                          {lead.source ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-pill bg-surface-subtle text-xs">
                              {lead.source}
                            </span>
                          ) : <Empty />}
                        </td>
                        <td className={cn(TD, 'text-text-secondary')}>
                          {lead.highlighted_remark ? (
                            <span className="flex items-center gap-1.5" title={lead.highlighted_remark}>
                              <Star size={12} fill="currentColor" className="shrink-0 text-amber-500" />
                              <span className="truncate max-w-[18rem] text-amber-700">
                                {lead.highlighted_remark}
                              </span>
                            </span>
                          ) : <Empty />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {leads.length < total && (
              <div className="p-4 text-center border-t border-border">
                <button
                  onClick={() => load(offset + LIMIT)}
                  disabled={loading}
                  className="text-sm text-finno-500 font-medium hover:underline disabled:opacity-50"
                >
                  {loading ? 'Loading…' : `Load more (${total - leads.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {total > 0 && !loading && (
        <p className="text-xs text-text-secondary">Showing {leads.length} of {total} leads</p>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { AlertTriangle, ClipboardList } from 'lucide-react'
import type { LeadStatus } from '@/types'

type LeadRow = {
  id: string
  full_name: string
  status: LeadStatus
  possible_duplicate: boolean
  agent_id: string | null
  agent_name: string | null
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
  const selectAllRef = useRef<HTMLInputElement>(null)

  const allSelected  = leads.length > 0 && selectedIds.size === leads.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(leads.map((l) => l.id)))
  }

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) })
    if (statusFilter)  params.set('status',  statusFilter)
    if (productFilter) params.set('product', productFilter)
    if (agentFilter)   params.set('agent',   agentFilter)
    if (teamFilter)    params.set('team',    teamFilter)
    const res  = await apiFetch(`/api/leads?${params}`)
    const data = await res.json()
    if (res.ok) {
      setLeads(off === 0 ? data.leads : (prev: LeadRow[]) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [statusFilter, productFilter, agentFilter, teamFilter])

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

  if (!canAccessPage) return null

  const hasFilters = statusFilter || productFilter || agentFilter || teamFilter

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
          {canFilterByTeam && (
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
              onClick={() => { setStatusFilter(''); setProductFilter(''); setAgentFilter(''); setTeamFilter('') }}
              className="text-xs text-finno-500 hover:underline shrink-0"
            >
              Clear
            </button>
          )}
        </div>
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
          <button
            type="button"
            className="text-sm text-text-secondary hover:text-text-primary shrink-0"
            onClick={() => { setSelectedIds(new Set()); setBulkMsg('') }}
          >
            Clear
          </button>
          {bulkMsg && <p className="text-xs text-text-secondary">{bulkMsg}</p>}
        </div>
      )}

      {/* Leads list */}
      <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">
            No leads found.{hasFilters ? ' Try clearing the filters.' : ''}
          </div>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-[auto_2fr_auto_1fr] gap-4 px-5 py-2.5 border-b border-border bg-surface-subtle text-xs font-semibold uppercase tracking-wide text-text-secondary items-center">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
                className="accent-finno-500 w-4 h-4 cursor-pointer"
              />
              <span>Name</span>
              <span>Status</span>
              <span>Assigned To</span>
            </div>

            <ul className="divide-y divide-border">
              {leads.map((lead) => (
                <li key={lead.id} className="flex items-stretch">
                  {/* Checkbox column — separate from the clickable button */}
                  <div className="flex items-center px-5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleRow(lead.id)}
                      aria-label={`Select ${lead.full_name}`}
                      className="accent-finno-500 w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <button
                    className="flex-1 min-w-0 text-left px-2 py-4 hover:bg-surface-subtle transition-colors"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <div className="sm:grid sm:grid-cols-[2fr_auto_1fr] sm:gap-4 sm:items-center">
                      <div className="flex items-center gap-2 min-w-0">
                        {lead.possible_duplicate && (
                          <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                        )}
                        <span className="font-semibold text-text-primary truncate">{lead.full_name}</span>
                      </div>
                      <div className="mt-2 sm:mt-0">
                        <StatusBadge status={lead.status} />
                      </div>
                      <div className="mt-2 sm:mt-0 text-xs text-text-secondary truncate">
                        {lead.agent_name ?? <span className="italic text-border">unassigned</span>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

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

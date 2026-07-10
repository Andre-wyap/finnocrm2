'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { ProductTag } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { AlertTriangle, UserCheck } from 'lucide-react'
import { setLeadNav } from '@/lib/lead-nav'

type LeadRow = {
  id: string
  full_name: string
  product_interest: string[]
  mobile: string
  source: string
  possible_duplicate: boolean
  created_at: string
}

type AssignableUser = {
  id: string
  full_name: string
  role: string
  team_name: string | null
}

const MYT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kuala_Lumpur',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-MY', MYT)
}

const LIMIT = 50

export default function UnassignedPage() {
  const router = useRouter()
  const { profile } = useAuth()
  const canAccessPage =
    profile?.role === 'admin' || profile?.role === 'subadmin' || profile?.role === 'team_leader'

  const [leads,   setLeads]   = useState<LeadRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [offset,  setOffset]  = useState(0)
  const [loading, setLoading] = useState(true)

  const [agents,      setAgents]      = useState<AssignableUser[]>([])
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [assigning,   setAssigning]   = useState(false)

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
    const params = new URLSearchParams({ status: 'unassigned', limit: String(LIMIT), offset: String(off) })
    const res = await apiFetch(`/api/leads?${params}`)
    if (res.ok) {
      const data = await res.json()
      setLeads(off === 0 ? data.leads : (prev: LeadRow[]) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!canAccessPage) { router.replace('/'); return }
    load(0)
    apiFetch('/api/agents').then((r) => r.json()).then(setAgents).catch(() => {})
  }, [canAccessPage, load, router])

  // Single-lead assign
  async function handleAssign(leadId: string) {
    if (!selectedAgent) return
    setAssigning(true)
    try {
      const res = await apiFetch(`/api/leads/${leadId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ agent_id: selectedAgent }),
      })
      if (res.ok) {
        setAssignTarget(null)
        setSelectedAgent('')
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(leadId); return n })
        setLeads((prev) => prev.filter((l) => l.id !== leadId))
        setTotal((t) => t - 1)
      }
    } finally {
      setAssigning(false)
    }
  }

  // Bulk assign
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
        setAssignTarget(null)
        await load(0)
        if (skipped > 0) setBulkMsg(`${assigned} assigned, ${skipped} skipped.`)
      }
    } finally {
      setBulkAssigning(false)
    }
  }

  if (!canAccessPage) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <UserCheck size={20} className="text-amber-500" />
        <h1 className="text-2xl font-bold text-text-primary">Unassigned Leads</h1>
        {!loading && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill text-sm font-semibold bg-amber-100 text-amber-700">
            {total}
          </span>
        )}
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
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}{a.team_name ? ` (${a.team_name})` : ''}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={handleBulkAssign}
            disabled={!bulkAgent}
            loading={bulkAssigning}
          >
            Assign Selected
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

      <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">
            No unassigned leads. All caught up!
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="hidden sm:grid grid-cols-[auto_2fr_auto_1fr_auto] gap-4 px-5 py-2.5 border-b border-border bg-surface-subtle text-xs font-semibold uppercase tracking-wide text-text-secondary items-center">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
                className="accent-finno-500 w-4 h-4 cursor-pointer"
              />
              <span>Name</span>
              <span>Products</span>
              <span>Source · Received</span>
              <span>Assign</span>
            </div>

            <ul className="divide-y divide-border">
              {leads.map((lead) => (
                <li key={lead.id} className="px-5 py-4">
                  <div className="sm:grid sm:grid-cols-[auto_2fr_auto_1fr_auto] sm:gap-4 sm:items-center">
                    {/* Checkbox */}
                    <div className="hidden sm:flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleRow(lead.id)}
                        aria-label={`Select ${lead.full_name}`}
                        className="accent-finno-500 w-4 h-4 cursor-pointer"
                      />
                    </div>

                    {/* Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Mobile-only checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleRow(lead.id)}
                        aria-label={`Select ${lead.full_name}`}
                        className="sm:hidden accent-finno-500 w-4 h-4 shrink-0 cursor-pointer"
                      />
                      {lead.possible_duplicate && (
                        <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                      )}
                      <button
                        className="font-semibold text-text-primary hover:text-finno-500 transition-colors text-left truncate"
                        onClick={() => { setLeadNav(leads.map((l) => l.id)); router.push(`/leads/${lead.id}`) }}
                      >
                        {lead.full_name}
                      </button>
                      <span className="text-xs text-text-secondary shrink-0">{lead.mobile}</span>
                    </div>

                    {/* Products */}
                    <div className="flex flex-wrap gap-1 mt-2 sm:mt-0">
                      {lead.product_interest.map((p) => <ProductTag key={p} product={p} />)}
                    </div>

                    {/* Source + date */}
                    <div className="mt-2 sm:mt-0 text-xs text-text-secondary">
                      {lead.source} · {formatDate(lead.created_at)}
                    </div>

                    {/* Per-row assign control */}
                    <div className="mt-3 sm:mt-0 flex items-center gap-2 flex-wrap">
                      {assignTarget === lead.id ? (
                        <>
                          <Select
                            value={selectedAgent}
                            onChange={(e) => setSelectedAgent(e.target.value)}
                            className="h-9 text-xs w-44"
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
                            onClick={() => handleAssign(lead.id)}
                            disabled={!selectedAgent}
                            loading={assigning}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setAssignTarget(null); setSelectedAgent('') }}
                            disabled={assigning}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setAssignTarget(lead.id); setSelectedAgent('') }}
                        >
                          Assign
                        </Button>
                      )}
                    </div>
                  </div>
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
        <p className="text-xs text-text-secondary">Showing {leads.length} of {total} unassigned leads</p>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { StatusBadge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { DashboardWidgets } from '@/components/dashboard/DashboardWidgets'
import {
  BulkFlowAction,
  bulkFlowOutcomeMessage,
  type BulkFlowOutcome,
} from '@/components/wa/BulkFlowAction'
import { AlertTriangle, Star } from 'lucide-react'
import { setLeadNav } from '@/lib/lead-nav'
import { insuranceAge } from '@/lib/age'
import type { LeadStatus } from '@/types'

type LeadRow = {
  id: string
  full_name: string
  status: LeadStatus
  mobile: string
  possible_duplicate: boolean
  date_of_birth: string | null
  agent_id: string | null
  agent_name: string | null
  highlighted_remark: string | null
}

function formatDob(dob: string): string {
  return new Date(dob).toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
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

// Leads list shown on the dashboard for agents only.
function AgentLeadsList() {
  const router = useRouter()
  const { profile } = useAuth()

  const [leads,   setLeads]   = useState<LeadRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset,  setOffset]  = useState(0)

  const [statusFilter,  setStatusFilter]  = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkFlowMsg, setBulkFlowMsg] = useState('')
  const selectAllRef = useRef<HTMLInputElement>(null)
  const waBulkEnabled = Boolean(profile?.wa_enabled)
  const allSelected = leads.length > 0 && selectedIds.size === leads.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) })
    if (statusFilter)  params.set('status',  statusFilter)
    if (productFilter) params.set('product', productFilter)
    const res  = await apiFetch(`/api/leads?${params}`)
    const data = await res.json()
    if (res.ok) {
      setLeads(off === 0 ? data.leads : (prev) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [statusFilter, productFilter])

  useEffect(() => {
    load(0)
    setSelectedIds(new Set())
  }, [load])

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(leads.map((lead) => lead.id)))
  }

  function handleBulkFlowComplete(outcome: BulkFlowOutcome) {
    setBulkFlowMsg(bulkFlowOutcomeMessage(outcome))
    setSelectedIds(new Set(outcome.skipped.map((item) => item.lead_id)))
  }

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="text-lg font-bold text-text-primary flex-1">My Leads</h2>
        <div className="flex gap-2">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36 h-9 text-xs">
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="w-36 h-9 text-xs">
            {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      </div>

      {waBulkEnabled && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-finno-500/20 bg-finno-500/5 px-4 py-3">
          <span className="text-sm font-semibold text-finno-500">
            {selectedIds.size} selected
          </span>
          <BulkFlowAction
            leadIds={Array.from(selectedIds)}
            onComplete={handleBulkFlowComplete}
          />
          <button
            type="button"
            className="text-sm text-text-secondary hover:text-text-primary"
            onClick={() => {
              setSelectedIds(new Set())
              setBulkFlowMsg('')
            }}
          >
            Clear
          </button>
        </div>
      )}
      {bulkFlowMsg && (
        <p className="rounded-button border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          {bulkFlowMsg}
        </p>
      )}

      <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">
            No leads found.{statusFilter || productFilter ? ' Try clearing the filters.' : ''}
          </div>
        ) : (
          <>
            <div className={`hidden sm:grid gap-4 px-5 py-2.5 border-b border-border bg-surface-subtle text-xs font-semibold uppercase tracking-wide text-text-secondary items-center ${
              waBulkEnabled ? 'grid-cols-[auto_2fr_auto]' : 'grid-cols-[2fr_auto]'
            }`}>
              {waBulkEnabled && (
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="accent-finno-500 w-4 h-4 cursor-pointer"
                />
              )}
              <span>Name</span>
              <span>Status</span>
            </div>

            <ul className="divide-y divide-border">
              {leads.map((lead) => (
                <li key={lead.id} className="flex items-stretch">
                  {waBulkEnabled && (
                    <div className="flex items-center px-5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleRow(lead.id)}
                        aria-label={`Select ${lead.full_name}`}
                        className="accent-finno-500 w-4 h-4 cursor-pointer"
                      />
                    </div>
                  )}
                  <button
                    className={`flex-1 min-w-0 text-left py-4 hover:bg-surface-subtle transition-colors ${
                      waBulkEnabled ? 'px-2' : 'px-5'
                    }`}
                    onClick={() => { setLeadNav({ ids: leads.map((l) => l.id), returnTo: '/' }); router.push(`/leads/${lead.id}`) }}
                  >
                    <div className="sm:grid sm:grid-cols-[2fr_auto] sm:gap-4 sm:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {lead.possible_duplicate && (
                            <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                          )}
                          <span className="font-semibold text-text-primary truncate">{lead.full_name}</span>
                        </div>
                        {lead.date_of_birth && (
                          <p className="text-xs text-text-secondary mt-0.5">
                            {formatDob(lead.date_of_birth)}
                            {insuranceAge(lead.date_of_birth) !== null && ` · Age ${insuranceAge(lead.date_of_birth)}`}
                          </p>
                        )}
                      </div>
                      <div className="mt-2 sm:mt-0">
                        <StatusBadge status={lead.status} />
                      </div>
                    </div>
                    {lead.highlighted_remark && (
                      <p className="flex items-start gap-1.5 mt-2 text-xs text-amber-700 bg-amber-50 rounded-button px-2 py-1">
                        <Star size={12} fill="currentColor" className="shrink-0 mt-0.5 text-amber-500" />
                        <span className="min-w-0">{lead.highlighted_remark}</span>
                      </p>
                    )}
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

// ── Dashboard page ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile } = useAuth()

  if (!profile) return null

  return (
    <div className="space-y-6">
      <DashboardWidgets role={profile.role} />
      {/* Agents see their own leads list directly below the widgets */}
      {profile.role === 'agent' && <AgentLeadsList />}
    </div>
  )
}

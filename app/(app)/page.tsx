'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { StatusBadge, ProductTag } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { DashboardWidgets } from '@/components/dashboard/DashboardWidgets'
import { AlertTriangle, UserCheck, ChevronDown, ChevronUp } from 'lucide-react'
import type { LeadStatus } from '@/types'

type LeadRow = {
  id: string
  full_name: string
  status: LeadStatus
  product_interest: string[]
  next_follow_up_at: string | null
  mobile: string
  source: string
  possible_duplicate: boolean
  case_size: number | null
  created_at: string
  agent_id: string | null
  agent_name: string | null
}

type AgentRow = {
  id: string
  full_name: string
  team_name: string | null
}

const MYT: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' }

function formatFollowUp(ts: string | null): { label: string; overdue: boolean } | null {
  if (!ts) return null
  const date = new Date(ts)
  const nowMYT = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  nowMYT.setHours(0, 0, 0, 0)
  return { label: date.toLocaleDateString('en-MY', MYT), overdue: date < nowMYT }
}

function formatShortDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-MY', MYT)
}

const STATUS_OPTS = [
  { value: '', label: 'All Statuses' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'lead', label: 'Lead' },
  { value: 'potential', label: 'Potential' },
  { value: 'closed', label: 'Closed' },
  { value: 'issued', label: 'Issued' },
  { value: 'lost', label: 'Lost' },
]

const PRODUCT_OPTS = [
  { value: '', label: 'All Products' },
  { value: 'medical', label: 'Medical' },
  { value: 'critical_illness', label: 'Critical Illness' },
  { value: 'life', label: 'Life' },
  { value: 'personal_accident', label: 'Personal Accident' },
]

export default function LeadsPage() {
  const router = useRouter()
  const { profile } = useAuth()
  const isAdminOrSubadmin = profile?.role === 'admin' || profile?.role === 'subadmin'

  // ── Main leads list ───────────────────────────────────────────────────────
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const limit = 50
  const [statusFilter, setStatusFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(limit), offset: String(off) })
    if (statusFilter) params.set('status', statusFilter)
    if (productFilter) params.set('product', productFilter)
    const res = await apiFetch(`/api/leads?${params}`)
    const data = await res.json()
    if (res.ok) {
      setLeads(off === 0 ? data.leads : (prev) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [statusFilter, productFilter])

  useEffect(() => { load(0) }, [load])

  // ── Unassigned queue (admin / subadmin) ───────────────────────────────────
  const [unassigned, setUnassigned] = useState<LeadRow[]>([])
  const [unassignedTotal, setUnassignedTotal] = useState(0)
  const [queueOpen, setQueueOpen] = useState(true)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [assigning, setAssigning] = useState(false)

  const loadUnassigned = useCallback(async () => {
    const res = await apiFetch('/api/leads?status=unassigned&limit=20&offset=0')
    if (res.ok) {
      const data = await res.json()
      setUnassigned(data.leads)
      setUnassignedTotal(data.total)
    }
  }, [])

  useEffect(() => {
    if (!isAdminOrSubadmin) return
    loadUnassigned()
    apiFetch('/api/agents').then((r) => r.json()).then(setAgents).catch(() => {})
  }, [isAdminOrSubadmin, loadUnassigned])

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
        await Promise.all([loadUnassigned(), load(0)])
      }
    } finally {
      setAssigning(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Dashboard widgets ─────────────────────────────────────────────── */}
      {profile && <DashboardWidgets role={profile.role} />}

      {/* ── Unassigned queue ─────────────────────────────────────────────── */}
      {isAdminOrSubadmin && unassignedTotal > 0 && (
        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-surface-subtle transition-colors"
            onClick={() => setQueueOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <UserCheck size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-text-primary">
                Unassigned Leads
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-semibold bg-amber-100 text-amber-700">
                {unassignedTotal}
              </span>
            </div>
            {queueOpen ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />}
          </button>

          {queueOpen && (
            <ul className="divide-y divide-border border-t border-border">
              {unassigned.map((lead) => (
                <li key={lead.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {lead.possible_duplicate && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                        <button
                          className="font-semibold text-sm text-text-primary hover:text-finno-500 transition-colors text-left truncate"
                          onClick={() => router.push(`/leads/${lead.id}`)}
                        >
                          {lead.full_name}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lead.product_interest.map((p) => <ProductTag key={p} product={p} />)}
                        <span className="text-xs text-text-secondary ml-1">{lead.mobile}</span>
                        <span className="text-xs text-text-secondary">· {formatShortDate(lead.created_at)}</span>
                      </div>
                    </div>

                    {assignTarget === lead.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={selectedAgent}
                          onChange={(e) => setSelectedAgent(e.target.value)}
                          className="h-9 rounded-button border border-border bg-surface-base px-2 text-sm text-text-primary focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15"
                        >
                          <option value="">Select agent…</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.full_name}{a.team_name ? ` (${a.team_name})` : ''}
                            </option>
                          ))}
                        </select>
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
                      </div>
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
                </li>
              ))}
              {unassignedTotal > 20 && (
                <li className="px-5 py-2.5 text-xs text-text-secondary text-center bg-surface-subtle">
                  Showing 20 of {unassignedTotal} unassigned leads.{' '}
                  <button
                    className="text-finno-500 hover:underline"
                    onClick={() => router.push('/leads/unassigned')}
                  >
                    View all
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ── Main leads list ───────────────────────────────────────────────── */}
      <div>
        {/* Header + filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <h1 className="text-2xl font-bold text-text-primary flex-1">Leads</h1>
          <div className="flex gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40 h-9 text-xs"
            >
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-40 h-9 text-xs"
            >
              {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>

        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
          {loading && leads.length === 0 ? (
            <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center text-text-secondary text-sm">
              No leads found.{statusFilter || productFilter ? ' Try clearing the filters.' : ''}
            </div>
          ) : (
            <>
              <div className="hidden sm:grid grid-cols-[2fr_auto_auto_auto_auto] gap-4 px-5 py-2.5 border-b border-border bg-surface-subtle text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <span>Name</span>
                <span>Status</span>
                <span>Products</span>
                <span>Follow-Up</span>
                {isAdminOrSubadmin && <span>Agent</span>}
              </div>

              <ul className="divide-y divide-border">
                {leads.map((lead) => {
                  const followUp = formatFollowUp(lead.next_follow_up_at)
                  return (
                    <li key={lead.id}>
                      <button
                        className="w-full text-left px-5 py-4 hover:bg-surface-subtle transition-colors"
                        onClick={() => router.push(`/leads/${lead.id}`)}
                      >
                        <div className="sm:grid sm:grid-cols-[2fr_auto_auto_auto_auto] sm:gap-4 sm:items-center">
                          <div className="flex items-center gap-2">
                            {lead.possible_duplicate && (
                              <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                            )}
                            <span className="font-semibold text-text-primary">{lead.full_name}</span>
                          </div>
                          <div className="mt-2 sm:mt-0">
                            <StatusBadge status={lead.status} />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2 sm:mt-0">
                            {lead.product_interest.map((p) => <ProductTag key={p} product={p} />)}
                          </div>
                          <div className="mt-2 sm:mt-0 text-xs">
                            {followUp ? (
                              <span className={followUp.overdue ? 'text-red-500 font-semibold' : 'text-text-secondary'}>
                                {followUp.label}
                              </span>
                            ) : (
                              <span className="text-border">—</span>
                            )}
                          </div>
                          {isAdminOrSubadmin && (
                            <div className="mt-2 sm:mt-0 text-xs text-text-secondary">
                              {lead.agent_name ?? <span className="italic text-border">unassigned</span>}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {leads.length < total && (
                <div className="p-4 text-center border-t border-border">
                  <button
                    onClick={() => load(offset + limit)}
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

        <p className="mt-3 text-xs text-text-secondary">
          {total > 0 ? `Showing ${leads.length} of ${total} leads` : ''}
        </p>
      </div>
    </div>
  )
}

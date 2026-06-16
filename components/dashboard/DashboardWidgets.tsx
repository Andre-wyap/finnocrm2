'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  UserPlus,
  CalendarClock,
  BarChart2,
  Banknote,
  AlertCircle,
  ChevronDown,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/client'
import type { Role } from '@/types'
import type { DashboardData } from '@/app/api/dashboard/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtRM(n: number): string {
  if (n >= 1_000_000) return `RM ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `RM ${(n / 1_000).toFixed(1)}k`
  return `RM ${n.toLocaleString()}`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  loading,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: React.ReactNode
  sub?: string
  accent?: 'teal' | 'amber' | 'violet'
  loading: boolean
}) {
  const accentClasses: Record<string, string> = {
    teal: 'bg-teal-500/10 text-teal-600',
    amber: 'bg-amber-100 text-amber-600',
    violet: 'bg-violet-100 text-violet-600',
  }
  const iconWrap = accent ? accentClasses[accent] : 'bg-finno-500/10 text-finno-500'
  return (
    <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-5 flex items-start gap-4">
      <div className={`rounded-lg p-2.5 shrink-0 ${iconWrap}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">{label}</p>
        {loading ? (
          <div className="h-7 w-16 bg-surface-subtle rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-text-primary leading-tight">{value}</p>
        )}
        {sub && !loading && (
          <p className="text-xs text-text-secondary mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  )
}

function PipelineCard({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const stages = [
    { key: 'lead' as const, label: 'Lead', bg: 'bg-blue-100 text-blue-700' },
    { key: 'potential' as const, label: 'Potential', bg: 'bg-violet-100 text-violet-700' },
    { key: 'closed' as const, label: 'Closed', bg: 'bg-teal-100 text-teal-700' },
    { key: 'issued' as const, label: 'Issued', bg: 'bg-green-100 text-green-700' },
  ]
  return (
    <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-5 flex items-start gap-4">
      <div className="rounded-lg p-2.5 shrink-0 bg-finno-500/10 text-finno-500">
        <BarChart2 size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">Pipeline</p>
        {loading ? (
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-6 w-16 bg-surface-subtle rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <span key={s.key} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-pill text-xs font-semibold ${s.bg}`}>
                {s.label}
                <span className="font-bold">{data?.pipeline[s.key] ?? 0}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AgentTable({ agents }: { agents: DashboardData['agents'] }) {
  if (agents.length === 0) {
    return <p className="text-sm text-text-secondary py-4 text-center">No active leads yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Agent</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Active</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-blue-600 text-right">Lead</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-violet-600 text-right">Potential</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-teal-600 text-right">Closed</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-green-600 text-right">Issued</th>
            <th className="py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Case Size</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((a) => (
            <tr key={a.agent_id} className="hover:bg-surface-subtle transition-colors">
              <td className="py-2.5 pr-4 font-medium text-text-primary">{a.agent_name}</td>
              <td className="py-2.5 pr-4 text-text-secondary text-right font-semibold">{a.total_count}</td>
              <td className="py-2.5 pr-4 text-blue-600 text-right">{a.lead_count}</td>
              <td className="py-2.5 pr-4 text-violet-600 text-right">{a.potential_count}</td>
              <td className="py-2.5 pr-4 text-teal-600 text-right">{a.closed_count}</td>
              <td className="py-2.5 pr-4 text-green-600 text-right">{a.issued_count}</td>
              <td className="py-2.5 text-text-secondary text-right">{a.case_size > 0 ? fmtRM(a.case_size) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamTable({ teams }: { teams: DashboardData['teams'] }) {
  if (teams.length === 0) {
    return <p className="text-sm text-text-secondary py-4 text-center">No team data.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Team</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Active Leads</th>
            <th className="py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Case Size</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {teams.map((t, i) => (
            <tr key={t.team_id ?? `no-team-${i}`} className="hover:bg-surface-subtle transition-colors">
              <td className="py-2.5 pr-4 font-medium text-text-primary">{t.team_name ?? <span className="italic text-text-secondary">No team</span>}</td>
              <td className="py-2.5 pr-4 text-text-secondary text-right font-semibold">{t.total_count}</td>
              <td className="py-2.5 text-text-secondary text-right">{t.case_size > 0 ? fmtRM(t.case_size) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourceTable({ sources }: { sources: DashboardData['sources'] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-text-secondary py-4 text-center">No source data.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Source / Campaign</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Active Leads</th>
            <th className="py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Case Size</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sources.map((s) => (
            <tr key={s.source} className="hover:bg-surface-subtle transition-colors">
              <td className="py-2.5 pr-4 font-medium text-text-primary font-mono text-xs">{s.source}</td>
              <td className="py-2.5 pr-4 text-text-secondary text-right font-semibold">{s.total_count}</td>
              <td className="py-2.5 text-text-secondary text-right">{s.case_size > 0 ? fmtRM(s.case_size) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 pl-3 pr-7 rounded-button border border-border bg-surface-base text-xs text-text-primary focus:outline-none focus:border-finno-500 focus:ring-3 focus:ring-finno-500/15 appearance-none cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
    </div>
  )
}

const PRODUCT_OPTS = [
  { value: '', label: 'All Products' },
  { value: 'medical', label: 'Medical' },
  { value: 'critical_illness', label: 'Critical Illness' },
  { value: 'life', label: 'Life' },
  { value: 'personal_accident', label: 'Personal Accident' },
]

// ── Main export ────────────────────────────────────────────────────────────────

export function DashboardWidgets({ role }: { role: Role }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(false)

  // Filters
  const [agentFilter, setAgentFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')

  const [breakdownOpen, setBreakdownOpen] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(false)
    try {
      const params = new URLSearchParams()
      if (agentFilter) params.set('agent', agentFilter)
      if (teamFilter) params.set('team', teamFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      if (productFilter) params.set('product', productFilter)
      const qs = params.toString()
      const res = await apiFetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      if (!res.ok) { setFetchErr(true); return }
      setData(await res.json())
    } catch {
      setFetchErr(true)
    } finally {
      setLoading(false)
    }
  }, [agentFilter, teamFilter, sourceFilter, productFilter])

  useEffect(() => { load() }, [load])

  if (fetchErr) return null

  const isAdminOrSubadmin = role === 'admin' || role === 'subadmin'
  const hasFilters = agentFilter || teamFilter || sourceFilter || productFilter

  return (
    <div className="space-y-4">
      {/* ── Filters ───────────────────────────────────────────────────────────── */}
      {(role === 'admin' || role === 'subadmin') && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Filter:</span>

          <FilterSelect value={productFilter} onChange={setProductFilter}>
            {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FilterSelect>

          {role === 'admin' && (
            <>
              <FilterSelect value={teamFilter} onChange={(v) => { setTeamFilter(v); setAgentFilter('') }}>
                <option value="">All Teams</option>
                {(data?.teams_list ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FilterSelect>
              <FilterSelect value={agentFilter} onChange={setAgentFilter}>
                <option value="">All Agents</option>
                {(data?.agents_list ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </FilterSelect>
            </>
          )}

          <FilterSelect value={sourceFilter} onChange={setSourceFilter}>
            <option value="">All Sources</option>
            {(data?.sources_list ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </FilterSelect>

          {hasFilters && (
            <button
              className="text-xs text-finno-500 hover:underline"
              onClick={() => { setAgentFilter(''); setTeamFilter(''); setSourceFilter(''); setProductFilter('') }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Agent view also gets a product filter */}
      {role === 'agent' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Filter:</span>
          <FilterSelect value={productFilter} onChange={setProductFilter}>
            {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FilterSelect>
          {productFilter && (
            <button className="text-xs text-finno-500 hover:underline" onClick={() => setProductFilter('')}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Stat cards ───────────────────────────────────────────────────────── */}
      <div className={`grid gap-4 ${isAdminOrSubadmin ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <StatCard
          icon={UserPlus}
          label="New Today"
          value={data?.new_leads_today ?? 0}
          sub="leads assigned today"
          loading={loading}
        />
        <StatCard
          icon={CalendarClock}
          label="Follow-Ups Due"
          value={data?.follow_ups_due ?? 0}
          sub="due by end of today"
          accent={data && data.follow_ups_due > 0 ? 'amber' : undefined}
          loading={loading}
        />
        <PipelineCard data={data} loading={loading} />
        <StatCard
          icon={Banknote}
          label="Case Size"
          value={data ? fmtRM(data.total_case_size) : '—'}
          sub="active pipeline"
          accent="teal"
          loading={loading}
        />
        {isAdminOrSubadmin && (
          <StatCard
            icon={AlertCircle}
            label="Unassigned"
            value={data?.unassigned_count ?? 0}
            sub="awaiting assignment"
            accent={data && data.unassigned_count > 0 ? 'amber' : undefined}
            loading={loading}
          />
        )}
      </div>

      {/* ── Breakdown tables ──────────────────────────────────────────────────── */}
      {isAdminOrSubadmin && (
        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-surface-subtle transition-colors border-b border-border"
            onClick={() => setBreakdownOpen((o) => !o)}
          >
            <span className="text-sm font-semibold text-text-primary">
              {role === 'admin' ? 'Agency Breakdown' : 'Team Breakdown'}
            </span>
            <ChevronDown
              size={16}
              className={`text-text-secondary transition-transform ${breakdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {breakdownOpen && (
            <div className="px-5 py-4 space-y-6">
              {loading ? (
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 bg-surface-subtle rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Agent</p>
                    <AgentTable agents={data?.agents ?? []} />
                  </div>

                  {role === 'admin' && (
                    <>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Team</p>
                        <TeamTable teams={data?.teams ?? []} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Campaign Source</p>
                        <SourceTable sources={data?.sources ?? []} />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

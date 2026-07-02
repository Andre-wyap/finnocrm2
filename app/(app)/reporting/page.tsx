'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { BarChart2, ChevronDown } from 'lucide-react'
import type { ReportingData } from '@/app/api/reporting/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtRM(n: number): string {
  if (n >= 1_000_000) return `RM ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `RM ${(n / 1_000).toFixed(1)}k`
  return `RM ${n.toLocaleString()}`
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

// ── Breakdown tables ───────────────────────────────────────────────────────────

function AgentTable({ agents, loading }: { agents: ReportingData['agents']; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (agents.length === 0) return <Empty text="No agent data." />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Agent / User</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Team</th>
            <th className="py-2.5 pr-2 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Active</th>
            <th className="py-2.5 pr-2 text-xs font-semibold uppercase tracking-wide text-blue-600 text-right">Lead</th>
            <th className="py-2.5 pr-2 text-xs font-semibold uppercase tracking-wide text-amber-600 text-right">Follow-up</th>
            <th className="py-2.5 pr-2 text-xs font-semibold uppercase tracking-wide text-violet-600 text-right">Potential</th>
            <th className="py-2.5 pr-2 text-xs font-semibold uppercase tracking-wide text-teal-600 text-right">Closed</th>
            <th className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-green-600 text-right">Issued</th>
            <th className="py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary text-right">Case Size</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {agents.map((a) => (
            <tr key={a.user_id} className="hover:bg-surface-subtle transition-colors">
              <td className="py-2.5 pr-4 font-medium text-text-primary">{a.user_name}</td>
              <td className="py-2.5 pr-4 text-text-secondary text-xs">{a.team_name ?? <span className="italic">—</span>}</td>
              <td className="py-2.5 pr-2 text-text-secondary text-right font-semibold">{a.total_count}</td>
              <td className="py-2.5 pr-2 text-blue-600 text-right">{a.lead_count}</td>
              <td className="py-2.5 pr-2 text-amber-600 text-right">{a.follow_up_count}</td>
              <td className="py-2.5 pr-2 text-violet-600 text-right">{a.potential_count}</td>
              <td className="py-2.5 pr-2 text-teal-600 text-right">{a.closed_count}</td>
              <td className="py-2.5 pr-4 text-green-600 text-right">{a.issued_count}</td>
              <td className="py-2.5 text-text-secondary text-right">{Number(a.case_size) > 0 ? fmtRM(Number(a.case_size)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamTable({ teams, loading }: { teams: ReportingData['teams']; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (teams.length === 0) return <Empty text="No team data." />
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
              <td className="py-2.5 pr-4 font-medium text-text-primary">
                {t.team_name ?? <span className="italic text-text-secondary">No team</span>}
              </td>
              <td className="py-2.5 pr-4 text-text-secondary text-right font-semibold">{t.total_count}</td>
              <td className="py-2.5 text-text-secondary text-right">{Number(t.case_size) > 0 ? fmtRM(Number(t.case_size)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourceTable({ sources, loading }: { sources: ReportingData['sources']; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (sources.length === 0) return <Empty text="No source data." />
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
              <td className="py-2.5 text-text-secondary text-right">{Number(s.case_size) > 0 ? fmtRM(Number(s.case_size)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-2 py-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-8 bg-surface-subtle rounded animate-pulse" />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-text-secondary py-4 text-center">{text}</p>
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PRODUCT_OPTS = [
  { value: '',                  label: 'All Products' },
  { value: 'medical',           label: 'Medical' },
  { value: 'critical_illness',  label: 'Critical Illness' },
  { value: 'life',              label: 'Life' },
  { value: 'personal_accident', label: 'Personal Accident' },
]

export default function ReportingPage() {
  const router  = useRouter()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isAdminOrSubadmin =
    profile?.role === 'admin' || profile?.role === 'subadmin' || profile?.role === 'team_leader'

  const [data, setData]       = useState<ReportingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState(false)

  const [productFilter, setProductFilter] = useState('')
  const [teamFilter,    setTeamFilter]    = useState('')
  const [sourceFilter,  setSourceFilter]  = useState('')
  const [userFilter,    setUserFilter]    = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(false)
    const params = new URLSearchParams()
    if (productFilter) params.set('product', productFilter)
    if (teamFilter)    params.set('team',    teamFilter)
    if (sourceFilter)  params.set('source',  sourceFilter)
    if (userFilter)    params.set('user',    userFilter)
    const qs = params.toString()
    try {
      const res = await apiFetch(`/api/reporting${qs ? `?${qs}` : ''}`)
      if (!res.ok) { setFetchErr(true); return }
      setData(await res.json())
    } catch {
      setFetchErr(true)
    } finally {
      setLoading(false)
    }
  }, [productFilter, teamFilter, sourceFilter, userFilter])

  useEffect(() => {
    if (profile && !isAdminOrSubadmin) {
      router.replace('/')
      return
    }
    load()
  }, [profile, isAdminOrSubadmin, load, router])

  if (!isAdminOrSubadmin) return null

  const hasFilters = productFilter || teamFilter || sourceFilter || userFilter

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart2 size={20} className="text-finno-500" />
        <h1 className="text-2xl font-bold text-text-primary">Reporting</h1>
      </div>

      {fetchErr ? (
        <div className="py-16 text-center text-text-secondary text-sm">
          Failed to load reporting data.{' '}
          <button onClick={load} className="text-finno-500 hover:underline">Retry</button>
        </div>
      ) : (
        <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
          {/* Filters */}
          <div className="px-5 py-3.5 border-b border-border flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary mr-1">Filter:</span>

            <FilterSelect value={productFilter} onChange={setProductFilter}>
              {PRODUCT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </FilterSelect>

            <FilterSelect value={sourceFilter} onChange={setSourceFilter}>
              <option value="">All Sources</option>
              {(data?.sources_list ?? []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </FilterSelect>

            {isAdmin && (
              <>
                <FilterSelect value={teamFilter} onChange={(v) => { setTeamFilter(v); setUserFilter('') }}>
                  <option value="">All Teams</option>
                  {(data?.teams_list ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </FilterSelect>

                <FilterSelect value={userFilter} onChange={setUserFilter}>
                  <option value="">All Users</option>
                  {(data?.users_list ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </FilterSelect>
              </>
            )}

            {hasFilters && (
              <button
                className="text-xs text-finno-500 hover:underline"
                onClick={() => {
                  setProductFilter('')
                  setTeamFilter('')
                  setSourceFilter('')
                  setUserFilter('')
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Breakdown sections */}
          <div className="px-5 py-5 space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Agent / User</p>
              <AgentTable agents={data?.agents ?? []} loading={loading} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Team</p>
              <TeamTable teams={data?.teams ?? []} loading={loading} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">By Campaign Source</p>
              <SourceTable sources={data?.sources ?? []} loading={loading} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

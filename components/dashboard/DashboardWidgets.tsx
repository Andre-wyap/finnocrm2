'use client'

import { useEffect, useState } from 'react'
import { UserPlus, BarChart2, Banknote, Inbox } from 'lucide-react'
import { apiFetch } from '@/lib/api/client'
import type { Role } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────────

type PipelineCounts = {
  lead:      number
  follow_up: number
  potential: number
  closed:    number
  issued:    number
}

type CaseSizeByStatus = {
  follow_up: number
  potential: number
  closed:    number
  issued:    number
  total:     number
}

export type DashboardData = {
  new_leads_today:     number
  unassigned_today:    number
  pipeline:            PipelineCounts
  case_size_by_status: CaseSizeByStatus
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtRM(n: number): string {
  if (n >= 1_000_000) return `RM ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `RM ${(n / 1_000).toFixed(1)}k`
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
  accent?: 'teal' | 'amber'
  loading: boolean
}) {
  const accentClasses: Record<string, string> = {
    teal:  'bg-teal-500/10 text-teal-600',
    amber: 'bg-amber-100 text-amber-600',
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
    { key: 'lead'      as const, label: 'Lead',      bg: 'bg-blue-100 text-blue-700' },
    { key: 'follow_up' as const, label: 'Follow-up', bg: 'bg-amber-100 text-amber-700' },
    { key: 'potential' as const, label: 'Potential', bg: 'bg-violet-100 text-violet-700' },
    { key: 'closed'    as const, label: 'Closed',    bg: 'bg-teal-100 text-teal-700' },
    { key: 'issued'    as const, label: 'Issued',    bg: 'bg-green-100 text-green-700' },
  ]
  return (
    <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-5 flex items-start gap-4">
      <div className="rounded-lg p-2.5 shrink-0 bg-finno-500/10 text-finno-500">
        <BarChart2 size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">Pipeline</p>
        {loading ? (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
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

function CaseSizeCard({ data, loading }: { data: DashboardData | null; loading: boolean }) {
  const stages = [
    { key: 'follow_up' as const, label: 'Follow-up', color: 'text-amber-600' },
    { key: 'potential' as const, label: 'Potential', color: 'text-violet-600' },
    { key: 'closed'    as const, label: 'Closed',    color: 'text-teal-600' },
    { key: 'issued'    as const, label: 'Issued',    color: 'text-green-600' },
  ]
  return (
    <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] p-5 flex items-start gap-4">
      <div className="rounded-lg p-2.5 shrink-0 bg-teal-500/10 text-teal-600">
        <Banknote size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">Case Size</p>
        {loading ? (
          <div className="space-y-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-4 w-28 bg-surface-subtle rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {stages.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4 text-xs">
                <span className={`${s.color} font-medium`}>{s.label}</span>
                <span className="text-text-secondary tabular-nums">
                  {fmtRM(data?.case_size_by_status[s.key] ?? 0)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 text-xs border-t border-border pt-1 mt-1">
              <span className="font-bold text-text-primary">Total</span>
              <span className="font-bold text-text-primary tabular-nums">
                {fmtRM(data?.case_size_by_status.total ?? 0)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────

export function DashboardWidgets({ role }: { role: Role }) {
  const [data, setData]         = useState<DashboardData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [fetchErr, setFetchErr] = useState(false)

  useEffect(() => {
    setLoading(true)
    setFetchErr(false)
    apiFetch('/api/dashboard')
      .then((r) => {
        if (!r.ok) { setFetchErr(true); return }
        return r.json()
      })
      .then((d) => d && setData(d))
      .catch(() => setFetchErr(true))
      .finally(() => setLoading(false))
  }, [])

  if (fetchErr) return null

  const canSeePool = role === 'admin' || role === 'subadmin' || role === 'team_leader'

  return (
    <div className={`grid gap-4 ${canSeePool ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
      <StatCard
        icon={UserPlus}
        label="Leads Assigned"
        value={data?.new_leads_today ?? 0}
        sub="assigned today"
        loading={loading}
      />
      {canSeePool && (
        <StatCard
          icon={Inbox}
          label="Leads Unassigned"
          value={data?.unassigned_today ?? 0}
          sub="arrived today, awaiting assignment"
          accent={data && data.unassigned_today > 0 ? 'amber' : undefined}
          loading={loading}
        />
      )}
      <PipelineCard data={data} loading={loading} />
      <CaseSizeCard data={data} loading={loading} />
    </div>
  )
}

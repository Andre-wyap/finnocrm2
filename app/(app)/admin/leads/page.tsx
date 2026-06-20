'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Archive, ArchiveRestore, Trash2, ShieldAlert } from 'lucide-react'
import type { LeadStatus } from '@/types'

type LeadRow = {
  id: string
  full_name: string
  status: LeadStatus
  agent_name: string | null
}

type Tab = 'active' | 'archived'
const LIMIT = 50

export default function AdminLeadsPage() {
  const router = useRouter()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [tab,     setTab]     = useState<Tab>('active')
  const [leads,   setLeads]   = useState<LeadRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [offset,  setOffset]  = useState(0)
  const [loading, setLoading] = useState(true)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [working,     setWorking]     = useState(false)
  const [msg,         setMsg]         = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const allSelected  = leads.length > 0 && selectedIds.size === leads.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(leads.map((l) => l.id)))
  }

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      archived: tab === 'archived' ? 'true' : 'false',
      limit: String(LIMIT),
      offset: String(off),
    })
    const res = await apiFetch(`/api/leads?${params}`)
    if (res.ok) {
      const data = await res.json()
      setLeads(off === 0 ? data.leads : (prev: LeadRow[]) => [...prev, ...data.leads])
      setTotal(data.total)
      setOffset(off)
    }
    setLoading(false)
  }, [tab])

  useEffect(() => {
    if (profile && !isAdmin) { router.replace('/'); return }
    load(0)
  }, [profile, isAdmin, load, router])

  function changeTab(t: Tab) {
    if (t === tab) return
    setSelectedIds(new Set())
    setMsg('')
    setTab(t)
  }

  async function runBulk(action: 'archive' | 'restore' | 'delete') {
    if (selectedIds.size === 0) return
    setWorking(true)
    setMsg('')
    try {
      const res = await apiFetch('/api/admin/leads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lead_ids: Array.from(selectedIds) }),
      })
      const data = await res.json()
      if (res.ok) {
        const done = data.archived ?? data.restored ?? data.deleted ?? 0
        const verb = action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'deleted'
        setMsg(`${done} ${verb}${data.skipped ? `, ${data.skipped} skipped` : ''}.`)
        setSelectedIds(new Set())
        await load(0)
      } else {
        setMsg(data.error ?? `Bulk ${action} failed.`)
      }
    } catch {
      setMsg('Network error — please try again.')
    } finally {
      setWorking(false)
      setConfirmDelete(false)
    }
  }

  if (!isAdmin) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldAlert size={20} className="text-finno-500 shrink-0" />
        <h1 className="text-2xl font-bold text-text-primary">Manage Leads</h1>
        {!loading && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-pill text-sm font-semibold bg-finno-500/10 text-finno-500">
            {total}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['active', 'archived'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => changeTab(t)}
            className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (tab === t
                ? 'border-finno-500 text-finno-500'
                : 'border-transparent text-text-secondary hover:text-text-primary')
            }
          >
            {t === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-finno-500/5 border border-finno-500/20 rounded-card">
          <span className="text-sm font-semibold text-finno-500 shrink-0">
            {selectedIds.size} selected
          </span>
          {tab === 'active' ? (
            <Button size="sm" variant="outline" onClick={() => runBulk('archive')} loading={working}>
              <Archive size={14} className="mr-1.5" /> Archive Selected
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => runBulk('restore')} loading={working}>
              <ArchiveRestore size={14} className="mr-1.5" /> Restore Selected
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmDelete(true)}
            disabled={working}
            className="!text-red-500 !border-red-300 hover:!bg-red-50"
          >
            <Trash2 size={14} className="mr-1.5" /> Delete Selected
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary hover:text-text-primary shrink-0"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-text-secondary">{msg}</p>}

      {/* List */}
      <div className="bg-surface-base rounded-card shadow-[0_1px_3px_rgba(0,0,0,0.07),0_4px_16px_rgba(0,0,0,0.05)] overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-16 text-center text-text-secondary text-sm">
            {tab === 'archived' ? 'No archived leads.' : 'No active leads.'}
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
                      <span className="font-semibold text-text-primary truncate">{lead.full_name}</span>
                      <div className="mt-2 sm:mt-0"><StatusBadge status={lead.status} /></div>
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

      {/* Permanent delete confirmation */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Leads">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Permanently delete{' '}
            <span className="font-semibold text-text-primary">{selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'}</span>?
            This removes each lead and its entire activity history. This cannot be undone — to keep
            records, archive them instead.
          </p>
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              onClick={() => runBulk('delete')}
              loading={working}
              className="flex-1 !bg-red-500 hover:!bg-red-600"
            >
              Delete Permanently
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

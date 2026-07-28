'use client'

import { useEffect, useState } from 'react'
import { Workflow } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import type { WaFlow } from '@/types'

export type BulkFlowOutcome = {
  started: Array<{ lead_id: string; run_id: string; run_at: string }>
  skipped: Array<{ lead_id: string; reason: string }>
}

export function bulkFlowOutcomeMessage(outcome: BulkFlowOutcome): string {
  const started = outcome.started.length
  const skipped = outcome.skipped.length
  const summary = `Flow started for ${started} ${started === 1 ? 'lead' : 'leads'}`
  if (skipped === 0) return `${summary}.`

  const reasonCounts = new Map<string, number>()
  for (const item of outcome.skipped) {
    reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1)
  }
  const reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => `${count} ${reason.toLowerCase()}`)
    .join('; ')
  return `${summary}; ${skipped} skipped (${reasons}).`
}

export function BulkFlowAction({
  leadIds,
  onComplete,
}: {
  leadIds: string[]
  onComplete: (outcome: BulkFlowOutcome) => void
}) {
  const { profile } = useAuth()
  const [flows, setFlows] = useState<WaFlow[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile?.wa_enabled) return
    apiFetch('/api/wa/flows')
      .then(async (res) => {
        if (res.ok) setFlows(await res.json())
      })
      .catch(() => setError('Could not load WhatsApp flows'))
  }, [profile?.wa_enabled])

  if (!profile?.wa_enabled) return null

  async function startFlow() {
    if (!selectedFlowId || leadIds.length === 0) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/wa/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_id: selectedFlowId, lead_ids: leadIds }),
      })
      const data = await res.json()
      if (
        Array.isArray(data.started)
        && Array.isArray(data.skipped)
      ) {
        onComplete(data as BulkFlowOutcome)
        if (data.started.length > 0) setSelectedFlowId('')
        return
      }
      setError(data.error ?? 'Could not start flow')
    } catch {
      setError('Could not reach the WhatsApp flow server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:border-l sm:border-finno-500/20 sm:pl-3">
      <Select
        value={selectedFlowId}
        onChange={(event) => {
          setSelectedFlowId(event.target.value)
          setError('')
        }}
        className="h-9 text-xs w-44"
        aria-label="WhatsApp flow"
      >
        <option value="">{flows.length === 0 ? 'No active flows' : 'Select flow…'}</option>
        {flows.map((flow) => (
          <option key={flow.id} value={flow.id}>{flow.name}</option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="accent"
        onClick={startFlow}
        disabled={!selectedFlowId}
        loading={loading}
      >
        <Workflow size={14} /> Start Flow
      </Button>
      {error && <p className="basis-full text-xs text-red-500">{error}</p>}
    </div>
  )
}

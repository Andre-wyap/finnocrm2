import { cn } from '@/lib/utils'
import type { LeadStatus, Role } from '@/types'

const STATUS_STYLES: Record<LeadStatus, string> = {
  unassigned: 'bg-amber-100 text-amber-700',
  lead:        'bg-blue-100 text-blue-700',
  follow_up:   'bg-orange-100 text-orange-700',
  potential:   'bg-violet-100 text-violet-700',
  closed:      'bg-teal-100 text-teal-700',
  issued:      'bg-green-100 text-green-700',
  lost:        'bg-gray-100 text-gray-500',
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  unassigned: 'Unassigned',
  lead:        'Lead',
  follow_up:   'Follow-up',
  potential:   'Potential',
  closed:      'Closed',
  issued:      'Issued',
  lost:        'Lost',
}

const ROLE_STYLES: Record<Role, string> = {
  admin:    'bg-finno-500/10 text-finno-500',
  subadmin: 'bg-teal-500/10 text-teal-500',
  agent:    'bg-gray-100 text-gray-600',
}

const ROLE_LABELS: Record<Role, string> = {
  admin:    'Admin',
  subadmin: 'Sub-Admin',
  agent:    'Agent',
}

const pillBase = 'inline-flex items-center px-2.5 py-0.5 rounded-pill text-xs font-semibold'

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={cn(pillBase, STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={cn(pillBase, ROLE_STYLES[role])}>
      {ROLE_LABELS[role]}
    </span>
  )
}

export function ProductTag({ product }: { product: string }) {
  const labels: Record<string, string> = {
    medical:             'Medical',
    critical_illness:    'CI',
    life:                'Life',
    personal_accident:   'PA',
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-medium bg-finno-500/8 text-finno-500">
      {labels[product] ?? product}
    </span>
  )
}

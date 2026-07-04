'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { RoleBadge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Users, X } from 'lucide-react'
import type { Role, TeamSource } from '@/types'

type UserRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: Role
  team_id: string | null
  team_name: string | null
  is_active: boolean
  created_at: string
}

type TeamRow = {
  id: string
  name: string
  subadmin_id: string | null
  subadmin_name: string | null
  agent_count: number
  member_count: number
  lead_count: number
  source_count: number
}

const EMPTY_USER = { full_name: '', email: '', role: 'agent' as Role, team_id: '' }

export default function ManageUsersPage() {
  const { profile } = useAuth()

  const [users, setUsers] = useState<UserRow[]>([])
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)

  const [addUserOpen, setAddUserOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [addTeamOpen, setAddTeamOpen] = useState(false)
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<TeamRow | null>(null)
  const [deletingTeam, setDeletingTeam] = useState(false)
  const [deleteTeamError, setDeleteTeamError] = useState('')

  const [teamSources, setTeamSources]     = useState<Record<string, TeamSource[]>>({})
  const [sourceInputFor, setSourceInputFor] = useState<string | null>(null)
  const [sourceInputValue, setSourceInputValue] = useState('')
  const [sourceError, setSourceError]     = useState('')
  const [sourceSubmitting, setSourceSubmitting] = useState(false)

  const [form, setForm] = useState(EMPTY_USER)
  const [teamName, setTeamName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [u, t] = await Promise.all([
      apiFetch('/api/admin/users').then((r) => r.json()),
      apiFetch('/api/admin/teams').then((r) => r.json()),
    ])
    setUsers(Array.isArray(u) ? u : [])
    const teamList: TeamRow[] = Array.isArray(t) ? t : []
    setTeams(teamList)

    const sourceEntries = await Promise.all(
      teamList.map(async (team) => {
        const res = await apiFetch(`/api/admin/teams/${team.id}/sources`)
        const sources = res.ok ? await res.json() : []
        return [team.id, Array.isArray(sources) ? sources : []] as const
      })
    )
    setTeamSources(Object.fromEntries(sourceEntries))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (profile?.role !== 'admin') {
    return (
      <div className="text-center py-24 text-text-secondary">
        You do not have permission to view this page.
      </div>
    )
  }

  // ── Add User ────────────────────────────────────────────────────────────────

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          role: form.role,
          team_id: form.team_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed to create user'); return }
      setInviteLink(data.inviteLink)
      await load()
    } catch {
      setFormError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function closeAddUser() {
    setAddUserOpen(false)
    setForm(EMPTY_USER)
    setFormError('')
    setInviteLink(null)
    setCopied(false)
  }

  // ── Edit User ───────────────────────────────────────────────────────────────

  function openEdit(u: UserRow) {
    setEditUser(u)
    setForm({ full_name: u.full_name, email: u.email, role: u.role, team_id: u.team_id ?? '' })
    setFormError('')
  }

  async function handleEditUser(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setFormError('')
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/admin/users/${editUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: form.full_name,
          role: form.role,
          team_id: form.team_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed to update user'); return }
      setEditUser(null)
      await load()
    } catch {
      setFormError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return
    setDeleteError('')
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDeleteError(data.error ?? 'Failed to delete user.')
        return
      }
      setDeleteTarget(null)
      await load()
    } catch {
      setDeleteError('Network error — please try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleActive(u: UserRow) {
    await apiFetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !u.is_active }),
    })
    await load()
  }

  // ── Add Team ────────────────────────────────────────────────────────────────

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await apiFetch('/api/admin/teams', {
        method: 'POST',
        body: JSON.stringify({ name: teamName }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed to create team'); return }
      setAddTeamOpen(false)
      setTeamName('')
      await load()
    } catch {
      setFormError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteTeam() {
    if (!deleteTeamTarget) return
    setDeleteTeamError('')
    setDeletingTeam(true)
    try {
      const res = await apiFetch(`/api/admin/teams/${deleteTeamTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDeleteTeamError(data.error ?? 'Failed to delete team.')
        return
      }
      setDeleteTeamTarget(null)
      await load()
    } catch {
      setDeleteTeamError('Network error — please try again.')
    } finally {
      setDeletingTeam(false)
    }
  }

  // ── Team ↔ source map ───────────────────────────────────────────────────────

  async function handleAddSource(teamId: string) {
    const source = sourceInputValue.trim()
    if (!source) return
    setSourceSubmitting(true)
    setSourceError('')
    try {
      const res = await apiFetch(`/api/admin/teams/${teamId}/sources`, {
        method: 'POST',
        body: JSON.stringify({ source }),
      })
      const data = await res.json()
      if (!res.ok) { setSourceError(data.error ?? 'Failed to add source'); return }
      setSourceInputFor(null)
      setSourceInputValue('')
      await load()
    } catch {
      setSourceError('Network error — please try again.')
    } finally {
      setSourceSubmitting(false)
    }
  }

  async function handleRemoveSource(teamId: string, sourceId: string) {
    await apiFetch(`/api/admin/teams/${teamId}/sources`, {
      method: 'DELETE',
      body: JSON.stringify({ source_id: sourceId }),
    })
    await load()
  }

  // ── Shared form fields ───────────────────────────────────────────────────────

  const renderUserFormFields = (showEmail?: boolean) => (
    <div className="flex flex-col gap-4">
      <Input
        label="Full Name"
        required
        value={form.full_name}
        onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
        placeholder="e.g. Sarah Tan"
      />
      {showEmail && (
        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="sarah@example.com"
        />
      )}
      <Select
        label="Role"
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role, team_id: '' }))}
      >
        <option value="agent">Agent</option>
        <option value="team_leader">Team Leader</option>
        <option value="subadmin">Sub-Admin</option>
        <option value="admin">Admin</option>
      </Select>
      <Select
        label="Team"
        value={form.team_id}
        onChange={(e) => setForm((f) => ({ ...f, team_id: e.target.value }))}
      >
        <option value="">— No team —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </Select>
      {(form.role === 'team_leader' || form.role === 'subadmin' || form.role === 'admin') && form.team_id && (
        <p className="text-xs text-text-secondary -mt-2">
          Picking a team here also makes this user that team&apos;s leader.
        </p>
      )}
      {formError && <p className="text-sm text-red-500">{formError}</p>}
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Users section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-text-primary">Users</h1>
          <Button size="sm" onClick={() => { setAddUserOpen(true); setForm(EMPTY_USER) }}>
            <Plus size={15} /> Add User
          </Button>
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-text-secondary text-sm">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-text-secondary text-sm">No users yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-text-secondary text-xs font-semibold uppercase tracking-wide">
                  <th className="px-5 py-3 text-left">Name</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Role</th>
                  <th className="px-5 py-3 text-left">Team</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-subtle transition-colors">
                    <td className="px-5 py-3 font-medium text-text-primary">{u.full_name}</td>
                    <td className="px-5 py-3 text-text-secondary">{u.email}</td>
                    <td className="px-5 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-5 py-3 text-text-secondary">{u.team_name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-pill transition-colors ${
                          u.is_active
                            ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600'
                            : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                        }`}
                        title={u.is_active ? 'Click to deactivate' : 'Click to activate'}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-text-secondary hover:text-finno-500 transition-colors p-1"
                          title="Edit user"
                        >
                          <Pencil size={15} />
                        </button>
                        {u.id !== profile?.id && (
                          <button
                            onClick={() => { setDeleteTarget(u); setDeleteError('') }}
                            className="text-text-secondary hover:text-red-500 transition-colors p-1"
                            title="Delete user"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Teams section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-text-primary">Teams</h2>
          <Button size="sm" variant="outline" onClick={() => { setAddTeamOpen(true); setTeamName('') }}>
            <Plus size={15} /> Add Team
          </Button>
        </div>

        {teams.length === 0 && !loading ? (
          <p className="text-sm text-text-secondary">No teams yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((t) => (
              <Card key={t.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-text-primary truncate">{t.name}</p>
                    <p className="text-sm text-text-secondary mt-1">
                      Team Leader: {t.subadmin_name ?? <span className="italic">Not assigned</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => { setDeleteTeamTarget(t); setDeleteTeamError('') }}
                    className="text-text-secondary hover:text-red-500 transition-colors p-1 shrink-0"
                    title="Delete team"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-text-secondary">
                  <Users size={13} />
                  {t.agent_count} agent{t.agent_count !== 1 ? 's' : ''}
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {t.member_count} member{t.member_count !== 1 ? 's' : ''} · {t.lead_count} lead{t.lead_count !== 1 ? 's' : ''}
                </p>

                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                    Sources
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(teamSources[t.id] ?? []).length === 0 ? (
                      <span className="text-xs text-text-secondary italic">No sources mapped</span>
                    ) : (
                      teamSources[t.id].map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs font-medium bg-finno-500/8 text-finno-500"
                        >
                          {s.source}
                          <button
                            onClick={() => handleRemoveSource(t.id, s.id)}
                            className="hover:text-red-500"
                            aria-label={`Remove ${s.source}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  {sourceInputFor === t.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        value={sourceInputValue}
                        onChange={(e) => setSourceInputValue(e.target.value)}
                        placeholder="e.g. medical-lp"
                        className="h-8 text-xs"
                      />
                      <Button size="sm" loading={sourceSubmitting} onClick={() => handleAddSource(t.id)}>
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSourceInputFor(null); setSourceInputValue(''); setSourceError('') }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSourceInputFor(t.id); setSourceInputValue(''); setSourceError('') }}
                      className="text-xs text-finno-500 hover:underline mt-2"
                    >
                      + Add source
                    </button>
                  )}
                  {sourceError && sourceInputFor === t.id && (
                    <p className="text-xs text-red-500 mt-1">{sourceError}</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add User dialog */}
      <Dialog open={addUserOpen} onClose={closeAddUser} title="Add New User">
        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-sm text-green-600 font-medium">✓ User created successfully!</p>
            <p className="text-sm text-text-secondary">
              Send this invite link to the new user so they can set their password:
            </p>
            <div className="bg-surface-subtle rounded-button p-3 text-xs text-text-secondary font-mono break-all select-all">
              {inviteLink}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true) }}
            >
              {copied ? '✓ Copied!' : 'Copy Invite Link'}
            </Button>
            <Button className="w-full" onClick={closeAddUser}>Done</Button>
          </div>
        ) : (
          <form onSubmit={handleAddUser} className="space-y-4">
            {renderUserFormFields(true)}
            <div className="flex gap-3 pt-1">
              <Button type="submit" loading={submitting} className="flex-1">Create User</Button>
              <Button type="button" variant="ghost" onClick={closeAddUser}>Cancel</Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Edit User dialog */}
      <Dialog open={!!editUser} onClose={() => setEditUser(null)} title="Edit User">
        <form onSubmit={handleEditUser} className="space-y-4">
          {renderUserFormFields()}
          <div className="flex gap-3 pt-1">
            <Button type="submit" loading={submitting} className="flex-1">Save Changes</Button>
            <Button type="button" variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>

      {/* Delete User confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete User">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Permanently delete <span className="font-semibold text-text-primary">{deleteTarget?.full_name}</span>?
            Their Firebase account is removed and any leads they own become unassigned.
            This cannot be undone — to keep lead history, deactivate them instead.
          </p>
          {deleteError && <p className="text-sm text-red-500">{deleteError}</p>}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              onClick={handleDeleteUser}
              loading={deleting}
              className="flex-1 !bg-red-500 hover:!bg-red-600"
            >
              Delete User
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      {/* Add Team dialog */}
      <Dialog open={addTeamOpen} onClose={() => setAddTeamOpen(false)} title="Add Team">
        <form onSubmit={handleAddTeam} className="space-y-4">
          <Input
            label="Team Name"
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. Team Medical"
          />
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex gap-3">
            <Button type="submit" loading={submitting} className="flex-1">Create Team</Button>
            <Button type="button" variant="ghost" onClick={() => setAddTeamOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Team confirmation dialog */}
      <Dialog open={!!deleteTeamTarget} onClose={() => setDeleteTeamTarget(null)} title="Delete Team">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Permanently delete <span className="font-semibold text-text-primary">{deleteTeamTarget?.name}</span>?
            This removes its source mappings and clears the team from assigned users and leads.
            Lead records and activity history are kept.
          </p>
          <div className="rounded-button bg-surface-subtle border border-border p-3 text-sm text-text-secondary">
            <p>{deleteTeamTarget?.member_count ?? 0} member{deleteTeamTarget?.member_count === 1 ? '' : 's'} will have no team.</p>
            <p>{deleteTeamTarget?.lead_count ?? 0} lead{deleteTeamTarget?.lead_count === 1 ? '' : 's'} will become orphan team leads.</p>
            <p>{deleteTeamTarget?.source_count ?? 0} source mapping{deleteTeamTarget?.source_count === 1 ? '' : 's'} will be removed.</p>
          </div>
          {deleteTeamError && <p className="text-sm text-red-500">{deleteTeamError}</p>}
          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              onClick={handleDeleteTeam}
              loading={deletingTeam}
              className="flex-1 !bg-red-500 hover:!bg-red-600"
            >
              Delete Team
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeleteTeamTarget(null)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

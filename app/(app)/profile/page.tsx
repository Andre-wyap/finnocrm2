'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  verifyBeforeUpdateEmail,
  updatePassword,
} from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useAuth } from '@/lib/auth/context'
import { apiFetch } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { MessageCircle, UserCircle } from 'lucide-react'

// ── Inline section card ─────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <h2 className="text-base font-semibold text-text-primary mb-4">{title}</h2>
        {children}
      </CardContent>
    </Card>
  )
}

// ── Profile info section ────────────────────────────────────────────────────

function ProfileInfoSection({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const { profile } = useAuth()

  const [fullName, setFullName] = useState('')
  const [phone,    setPhone]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        setFullName(d.full_name ?? '')
        setPhone(d.phone ?? '')
      })
      .catch(() => {})
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, phone }),
      })
      if (!res.ok) throw new Error()
      await onRefresh()
      setMsg({ ok: true, text: 'Profile updated.' })
    } catch {
      setMsg({ ok: false, text: 'Failed to save. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="Profile Information">
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <Input
          label="Full Name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <Input
          label="Phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+60 12-345 6789"
        />
        <div className="text-sm text-text-secondary">
          Email: <span className="font-medium text-text-primary">{profile?.email ?? '—'}</span>
          <span className="ml-1 text-xs">(change below)</span>
        </div>
        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-teal-600' : 'text-red-500'}`}>{msg.text}</p>
        )}
        <Button type="submit" loading={saving} className="self-start">
          Save Changes
        </Button>
      </form>
    </SectionCard>
  )
}

// ── Change email section ────────────────────────────────────────────────────

function ChangeEmailSection({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail,        setNewEmail]        = useState('')
  const [saving,          setSaving]          = useState(false)
  const [msg,             setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      const firebaseUser = auth.currentUser
      if (!firebaseUser || !firebaseUser.email) throw new Error('Not signed in')

      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword)
      await reauthenticateWithCredential(firebaseUser, credential)

      // Firebase blocks the legacy updateEmail() when email-enumeration
      // protection is on (the default). verifyBeforeUpdateEmail() sends a
      // confirmation link to the NEW address; the sign-in email only changes
      // once the user clicks it. We still sync the CRM contact email now.
      await verifyBeforeUpdateEmail(firebaseUser, newEmail)

      const res = await apiFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      })
      if (!res.ok) throw new Error()

      await onRefresh()
      setCurrentPassword('')
      setNewEmail('')
      setMsg({
        ok: true,
        text: `Confirmation link sent to ${newEmail}. Click it to finish changing your sign-in email, then log in with the new address.`,
      })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setMsg({ ok: false, text: 'Current password is incorrect.' })
      } else if (code === 'auth/email-already-in-use') {
        setMsg({ ok: false, text: 'That email is already in use.' })
      } else if (code === 'auth/invalid-new-email') {
        setMsg({ ok: false, text: 'That email address is not valid.' })
      } else {
        setMsg({ ok: false, text: 'Failed to update email. Please try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="Change Email">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Current Password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Input
          label="New Email"
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
        />
        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-teal-600' : 'text-red-500'}`}>{msg.text}</p>
        )}
        <Button type="submit" loading={saving} className="self-start">
          Update Email
        </Button>
      </form>
    </SectionCard>
  )
}

// ── Change password section ─────────────────────────────────────────────────

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirm,         setConfirm]         = useState('')
  const [saving,          setSaving]          = useState(false)
  const [msg,             setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirm) {
      setMsg({ ok: false, text: 'New passwords do not match.' })
      return
    }
    if (newPassword.length < 8) {
      setMsg({ ok: false, text: 'Password must be at least 8 characters.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const firebaseUser = auth.currentUser
      if (!firebaseUser || !firebaseUser.email) throw new Error('Not signed in')

      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword)
      await reauthenticateWithCredential(firebaseUser, credential)
      await updatePassword(firebaseUser, newPassword)

      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setMsg({ ok: true, text: 'Password updated.' })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setMsg({ ok: false, text: 'Current password is incorrect.' })
      } else {
        setMsg({ ok: false, text: 'Failed to update password. Please try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="Change Password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Current Password"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Input
          label="New Password"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
        />
        <Input
          label="Confirm New Password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
        />
        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-teal-600' : 'text-red-500'}`}>{msg.text}</p>
        )}
        <Button type="submit" loading={saving} className="self-start">
          Update Password
        </Button>
      </form>
    </SectionCard>
  )
}

// ── WhatsApp connection section (only for admin-enabled users) ──────────────

type WaStatus = 'loading' | 'not_created' | 'disconnected' | 'connecting' | 'connected'

function WhatsAppSection() {
  const [status, setStatus] = useState<WaStatus>('loading')
  const [phone,  setPhone]  = useState<string | null>(null)
  const [qr,     setQr]     = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [qrExpired, setQrExpired] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCount = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current)
    pollTimer.current = null
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/wa/instance')
      const d = await res.json()
      if (!res.ok) throw new Error()
      const s: WaStatus = d.status === 'not_created' ? 'not_created' : d.status
      setStatus(s)
      setPhone(d.phone_number ?? null)
      if (s === 'connected') { stopPolling(); setQr(null) }
      return s
    } catch {
      setStatus((prev) => (prev === 'loading' ? 'disconnected' : prev))
      return null
    }
  }, [stopPolling])

  useEffect(() => {
    refresh()
    return stopPolling
  }, [refresh, stopPolling])

  async function handleConnect() {
    setBusy(true)
    setError('')
    setQrExpired(false)
    try {
      const res = await apiFetch('/api/wa/instance', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed to start the WhatsApp connection.'); return }
      if (d.status === 'connected') {
        setStatus('connected')
        setPhone(d.phone_number ?? null)
        return
      }
      setStatus('connecting')
      setQr(d.qr ?? null)
      setPairingCode(d.pairing_code ?? null)

      // Poll until the phone scans the QR; a WhatsApp QR goes stale after
      // ~2 minutes, so stop then and offer a fresh one.
      pollCount.current = 0
      stopPolling()
      pollTimer.current = setInterval(async () => {
        pollCount.current += 1
        if (pollCount.current > 40) {
          stopPolling()
          setQr(null)
          setQrExpired(true)
          setStatus('disconnected')
          return
        }
        await refresh()
      }, 3000)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    setError('')
    stopPolling()
    try {
      const res = await apiFetch('/api/wa/instance', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setQr(null)
      setStatus('disconnected')
      setPhone(null)
    } catch {
      setError('Failed to disconnect — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const qrSrc = qr ? (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`) : null

  return (
    <SectionCard title="WhatsApp Connection">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <MessageCircle size={16} className={status === 'connected' ? 'text-teal-600' : 'text-text-secondary'} />
          {status === 'loading' && <span className="text-text-secondary">Checking connection…</span>}
          {status === 'connected' && (
            <span className="text-text-primary">
              Connected{phone ? <> as <span className="font-semibold">+{phone}</span></> : null}
            </span>
          )}
          {status === 'connecting' && <span className="text-text-secondary">Waiting for QR scan…</span>}
          {(status === 'disconnected' || status === 'not_created') && (
            <span className="text-text-secondary">Not connected</span>
          )}
        </div>

        {qrSrc && status === 'connecting' && (
          <div className="flex flex-col items-center gap-2 p-4 bg-surface-subtle rounded-button">
            {/* Evolution returns the QR as a base64 data URI, not a hosted image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="WhatsApp pairing QR code" className="w-52 h-52" />
            <p className="text-xs text-text-secondary text-center">
              Open WhatsApp on your phone → Settings → Linked Devices → Link a Device, then scan this code.
            </p>
            {pairingCode && (
              <p className="text-xs text-text-secondary">
                Or enter pairing code: <span className="font-mono font-semibold">{pairingCode}</span>
              </p>
            )}
          </div>
        )}

        {qrExpired && (
          <p className="text-sm text-text-secondary">
            The QR code expired. Generate a new one to try again.
          </p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          {status === 'connected' ? (
            <Button variant="outline" loading={busy} onClick={handleDisconnect}>
              Disconnect
            </Button>
          ) : status !== 'loading' ? (
            <Button loading={busy} onClick={handleConnect}>
              {status === 'connecting' && qrSrc ? 'Generate New QR' : 'Connect WhatsApp'}
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-text-secondary">
          Messages you send from the CRM go out from this WhatsApp number. Keep your phone online.
        </p>
      </div>
    </SectionCard>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-2">
        <UserCircle size={20} className="text-finno-500 shrink-0" />
        <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
      </div>

      <ProfileInfoSection onRefresh={refreshProfile} />
      {profile?.wa_enabled && <WhatsAppSection />}
      <ChangeEmailSection onRefresh={refreshProfile} />
      <ChangePasswordSection />
    </div>
  )
}

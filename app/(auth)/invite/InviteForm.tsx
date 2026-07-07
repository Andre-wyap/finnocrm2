'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function InviteForm({ token }: { token: string }) {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!token) {
      setError('Invite token is missing. Ask an admin to resend the invite.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to accept invite.')
        return
      }

      await signInWithEmailAndPassword(auth, data.email, password)
      router.replace('/')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-subtle">
      <div className="w-full max-w-sm">
        <p className="text-center text-3xl font-extrabold tracking-tight text-finno-500 mb-1">
          FINNO.
        </p>
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-text-secondary mb-8">
          CRM Portal
        </p>

        <Card>
          <CardContent>
            <h1 className="text-xl font-bold text-text-primary mb-1">Set Your Password</h1>
            <p className="text-sm text-text-secondary mb-6">
              This invite link expires 24 hours after it is generated.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="New Password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <Input
                label="Confirm Password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" loading={submitting} className="w-full">
                Set Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

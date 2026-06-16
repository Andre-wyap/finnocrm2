'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useAuth } from '@/lib/auth/context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already signed in → go to app
  useEffect(() => {
    if (!loading && user) router.replace('/')
  }, [user, loading, router])

  if (loading || user) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      router.replace('/')
    } catch {
      setError('Invalid email or password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-subtle">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <p className="text-center text-3xl font-extrabold tracking-tight text-finno-500 mb-1">
          FINNO.
        </p>
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-text-secondary mb-8">
          CRM Portal
        </p>

        <Card>
          <CardContent>
            <h1 className="text-xl font-bold text-text-primary mb-6">Sign In</h1>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              {error ? (
                <p className="text-sm text-red-500">{error}</p>
              ) : null}
              <Button type="submit" loading={submitting} className="mt-2 w-full">
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-text-secondary">
          Simple, sustainable, and stress-free.
        </p>
      </div>
    </div>
  )
}

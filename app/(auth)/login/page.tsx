'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useAuth } from '@/lib/auth/context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [forgotMode,    setForgotMode]    = useState(false)
  const [resetSent,     setResetSent]     = useState(false)
  const [resetEmail,    setResetEmail]    = useState('')
  const [resetSending,  setResetSending]  = useState(false)
  const [resetError,    setResetError]    = useState('')

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

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    setResetSending(true)
    try {
      await sendPasswordResetEmail(auth, resetEmail)
      setResetSent(true)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        setResetError('No account found with that email.')
      } else {
        setResetError('Failed to send reset email. Please try again.')
      }
    } finally {
      setResetSending(false)
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

        {forgotMode ? (
          <Card>
            <CardContent>
              <h1 className="text-xl font-bold text-text-primary mb-1">Reset Password</h1>
              <p className="text-sm text-text-secondary mb-6">
                Enter your email and we will send a reset link.
              </p>
              {resetSent ? (
                <div className="space-y-4">
                  <p className="text-sm text-teal-600">
                    Reset link sent to <span className="font-medium">{resetEmail}</span>. Check your inbox.
                  </p>
                  <button
                    type="button"
                    className="text-sm text-finno-500 hover:underline"
                    onClick={() => { setForgotMode(false); setResetSent(false); setResetEmail('') }}
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="flex flex-col gap-4">
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  {resetError && <p className="text-sm text-red-500">{resetError}</p>}
                  <Button type="submit" loading={resetSending} className="w-full">
                    Send Reset Link
                  </Button>
                  <button
                    type="button"
                    className="text-sm text-text-secondary hover:text-finno-500 text-center"
                    onClick={() => { setForgotMode(false); setResetError('') }}
                  >
                    Back to Sign In
                  </button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
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
                <div className="flex flex-col gap-1">
                  <Input
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="text-xs text-finno-500 hover:underline self-end"
                    onClick={() => { setForgotMode(true); setResetEmail(email); setError('') }}
                  >
                    Forgot password?
                  </button>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" loading={submitting} className="mt-2 w-full">
                  Sign In
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-text-secondary">
          Simple, sustainable, and stress-free.
        </p>
      </div>
    </div>
  )
}

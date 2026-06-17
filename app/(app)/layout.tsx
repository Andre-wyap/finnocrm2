'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { useAuth } from '@/lib/auth/context'
import { LogOut, Users, LayoutDashboard, UserCircle, ClipboardList, BarChart2 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle">
        <div className="h-8 w-8 rounded-full border-2 border-finno-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) return null

  async function handleSignOut() {
    await signOut(auth)
    router.replace('/login')
  }

  const roleLabel: Record<string, string> = {
    admin: 'Admin',
    subadmin: 'Sub-Admin',
    agent: 'Agent',
  }

  const isAdminOrSubadmin = profile?.role === 'admin' || profile?.role === 'subadmin'

  const navLinks = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ...(isAdminOrSubadmin
      ? [
          { href: '/leads',            label: 'Leads',      icon: ClipboardList },
          { href: '/reporting',        label: 'Reporting',  icon: BarChart2 },
          { href: '/leads/unassigned', label: 'Unassigned', icon: Users },
        ]
      : []),
    ...(profile?.role === 'admin'
      ? [{ href: '/admin/users', label: 'Users', icon: UserCircle }]
      : []),
    { href: '/profile', label: 'Profile', icon: UserCircle },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-surface-subtle">
      {/* Top nav */}
      <header className="h-14 bg-finno-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <span className="text-white font-extrabold tracking-tight text-lg select-none">
            FINNO.
          </span>
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  (href === '/' ? pathname === '/' : pathname.startsWith(href))
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}
              >
                <Icon size={15} strokeWidth={2} />
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {profile ? (
            <div className="text-right hidden sm:block">
              <p className="text-white text-sm font-medium leading-tight">{profile.full_name}</p>
              <p className="text-white/50 text-xs leading-tight">
                {roleLabel[profile.role] ?? profile.role}
              </p>
            </div>
          ) : null}
          <button
            onClick={handleSignOut}
            className="text-white/70 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
            title="Sign out"
          >
            <LogOut size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

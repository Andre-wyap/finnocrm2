import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import Providers from '@/components/auth-provider'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'FINNO. CRM',
  description: 'Simple, sustainable, and stress-free insurance management.',
}

// Render every route per-request so its HTML is served with `no-store` instead
// of the one-year `s-maxage` that Next.js stamps on statically prerendered
// pages. On a self-hosted CDN (Hostinger LiteSpeed) that long-lived HTML
// outlives each rebuild and keeps pointing at hashed CSS/JS filenames the new
// build has deleted — which loads the app with no styling. This CRM is fully
// auth-gated, so there is nothing to gain from caching these shells.
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
          <Providers>{children}</Providers>
        </body>
    </html>
  )
}

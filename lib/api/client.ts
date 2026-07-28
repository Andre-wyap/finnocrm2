'use client'

import { auth } from '@/lib/firebase/client'

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await auth.currentUser?.getIdToken()
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  return fetch(path, {
    ...init,
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
}

import { adminAuth } from '@/lib/firebase/admin'
import sql from '@/lib/db/client'
import type { Profile } from '@/types'

/**
 * Verify a Firebase ID token from the Authorization header and resolve it
 * to the internal profiles.id. Returns null if the token is missing, expired,
 * or the profile doesn't exist (or is inactive).
 */
export async function resolveUser(
  authHeader: string | null
): Promise<Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'team_id'> | null> {
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  let firebaseUid: string
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    firebaseUid = decoded.uid
  } catch {
    return null
  }

  // Use a SECURITY DEFINER function to bypass the RLS chicken-and-egg:
  // the profiles SELECT policy requires app.current_user_id to be set,
  // but we need the profiles.id to set it in the first place.
  const rows = await sql<Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'team_id'>[]>`
    SELECT id, full_name, email, role, team_id
    FROM get_profile_by_firebase_uid(${firebaseUid})
  `

  return rows[0] ?? null
}

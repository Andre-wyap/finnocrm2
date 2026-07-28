import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/admin-guard'
import { withUser } from '@/lib/db/rls'
import {
  createInstance,
  connectInstance,
  getConnectionState,
  getInstancePhoneNumber,
  logoutInstance,
  deleteInstance,
  EvolutionError,
} from '@/lib/wa/evolution'
import type { WaInstanceStatus } from '@/types'

type InstanceRow = {
  id: string
  instance_name: string
  status: WaInstanceStatus
  phone_number: string | null
  connected_at: string | null
}

// Evolution instance names are per-profile and deterministic, so reconnecting
// after a disconnect always lands on the same instance.
function instanceNameFor(profileId: string): string {
  return `finno_${profileId}`
}

async function getOwnInstance(profileId: string): Promise<InstanceRow | null> {
  const rows = await withUser(profileId, (tx) =>
    tx<InstanceRow[]>`
      SELECT id, instance_name, status, phone_number, connected_at
      FROM wa_instances WHERE profile_id = ${profileId}::uuid LIMIT 1
    `
  )
  return rows[0] ?? null
}

async function updateOwnInstance(
  profileId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await withUser(profileId, async (tx) => {
    await tx`UPDATE wa_instances SET ${tx(updates)} WHERE profile_id = ${profileId}::uuid`
  })
}

// ── GET — current connection status (refreshes from Evolution) ───────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (!profile.wa_enabled) return NextResponse.json({ enabled: false, status: 'disabled' })

  const row = await getOwnInstance(profile.id)
  if (!row) return NextResponse.json({ enabled: true, status: 'not_created' })

  // Refresh the stored status from Evolution; if Evolution is down, fall back
  // to what we last knew rather than failing the whole profile page.
  let status: WaInstanceStatus = row.status
  let phone = row.phone_number
  try {
    const state = await getConnectionState(row.instance_name)
    status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
    if (status === 'connected' && !phone) {
      phone = await getInstancePhoneNumber(row.instance_name).catch(() => null)
    }
    if (status !== row.status || phone !== row.phone_number) {
      await updateOwnInstance(profile.id, {
        status,
        phone_number: status === 'connected' ? phone : row.phone_number,
        connected_at: status === 'connected' ? (row.connected_at ?? new Date()) : null,
      })
    }
  } catch (err) {
    console.error('[wa/instance GET] Evolution state check failed:', err)
    return NextResponse.json({
      enabled: true,
      status,
      phone_number: phone,
      connected_at: row.connected_at,
      evolution_unreachable: true,
    })
  }

  return NextResponse.json({
    enabled: true,
    status,
    phone_number: phone,
    connected_at: status === 'connected' ? (row.connected_at ?? new Date().toISOString()) : null,
  })
}

// ── POST — create the instance (if needed) and get a pairing QR ──────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  if (!profile.wa_enabled) {
    return NextResponse.json({ error: 'WhatsApp is not enabled for your account.' }, { status: 403 })
  }

  const instanceName = instanceNameFor(profile.id)

  try {
    await createInstance(instanceName)

    // Already paired? Refresh the row and skip the QR.
    const state = await getConnectionState(instanceName).catch(() => 'close' as const)
    if (state === 'open') {
      const phone = await getInstancePhoneNumber(instanceName).catch(() => null)
      await withUser(profile.id, async (tx) => {
        await tx`
          INSERT INTO wa_instances (profile_id, instance_name, status, phone_number, connected_at)
          VALUES (${profile.id}::uuid, ${instanceName}, 'connected', ${phone}, now())
          ON CONFLICT (profile_id) DO UPDATE
            SET status = 'connected', phone_number = ${phone},
                connected_at = COALESCE(wa_instances.connected_at, now())
        `
      })
      return NextResponse.json({ status: 'connected', phone_number: phone })
    }

    const { qrBase64, pairingCode } = await connectInstance(instanceName)
    await withUser(profile.id, async (tx) => {
      await tx`
        INSERT INTO wa_instances (profile_id, instance_name, status)
        VALUES (${profile.id}::uuid, ${instanceName}, 'connecting')
        ON CONFLICT (profile_id) DO UPDATE
          SET status = 'connecting', phone_number = NULL, connected_at = NULL
      `
    })

    if (!qrBase64 && !pairingCode) {
      return NextResponse.json(
        { error: 'Evolution API did not return a QR code. Try again in a few seconds.' },
        { status: 502 }
      )
    }
    return NextResponse.json({ status: 'connecting', qr: qrBase64, pairing_code: pairingCode })
  } catch (err) {
    console.error('[wa/instance POST] connect failed:', err)
    const status = err instanceof EvolutionError && err.status >= 500 ? 502 : 500
    return NextResponse.json({ error: 'Could not reach the WhatsApp server. Please try again.' }, { status })
  }
}

// ── DELETE — log out and forget the WhatsApp session ─────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { profile, error } = await requireAuth(req)
  if (error) return error

  const row = await getOwnInstance(profile.id)
  if (!row) return NextResponse.json({ ok: true })

  // Best-effort teardown in Evolution — the local row is the source of truth
  // for the UI, so a dead Evolution server must not block disconnecting.
  await logoutInstance(row.instance_name).catch(() => {})
  await deleteInstance(row.instance_name).catch((e) =>
    console.error('[wa/instance DELETE] Evolution delete failed:', e)
  )

  await updateOwnInstance(profile.id, {
    status: 'disconnected',
    phone_number: null,
    connected_at: null,
  })

  return NextResponse.json({ ok: true })
}

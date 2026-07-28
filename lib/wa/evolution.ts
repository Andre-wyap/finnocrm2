/**
 * Thin server-side client for the self-hosted Evolution API (WhatsApp).
 * All calls carry the global apikey header — EVOLUTION_API_URL and
 * EVOLUTION_API_KEY are server-side secrets, never exposed to the browser.
 *
 * Evolution drives WhatsApp Web (Baileys), so "state" mirrors the phone's
 * pairing lifecycle: 'open' = connected, 'connecting' = QR pending,
 * 'close' = logged out / never paired.
 */

export class EvolutionError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'EvolutionError'
    this.status = status
  }
}

function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!baseUrl || !apiKey) {
    throw new EvolutionError('Evolution API is not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY)', 500)
  }
  return { baseUrl, apiKey }
}

async function evo<T = Record<string, unknown>>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const { baseUrl, apiKey } = config()
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new EvolutionError(
      `Evolution API unreachable: ${err instanceof Error ? err.message : String(err)}`, 502
    )
  }

  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }

  if (!res.ok) {
    const message =
      (data as { response?: { message?: unknown }; message?: unknown })?.response?.message ??
      (data as { message?: unknown })?.message ??
      text
    throw new EvolutionError(
      `Evolution API ${res.status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
      res.status
    )
  }
  return data as T
}

export type EvolutionConnectionState = 'open' | 'connecting' | 'close' | 'unknown'

/** Create an instance. Safe to call again for an existing name (treated as OK). */
export async function createInstance(instanceName: string): Promise<void> {
  try {
    await evo('/instance/create', {
      method: 'POST',
      body: { instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true },
    })
  } catch (err) {
    // Re-creating an existing instance returns 403 "already in use" — idempotent for us.
    if (err instanceof EvolutionError && /already|in use/i.test(err.message)) return
    throw err
  }
}

/** Request a pairing QR for an instance. Returns null qr when already connected. */
export async function connectInstance(
  instanceName: string
): Promise<{ qrBase64: string | null; pairingCode: string | null }> {
  const data = await evo<{
    base64?: string
    code?: string
    pairingCode?: string
    qrcode?: { base64?: string; code?: string; pairingCode?: string }
  }>(`/instance/connect/${encodeURIComponent(instanceName)}`)

  // Shape differs across Evolution versions: QR fields at the top level or under `qrcode`.
  const qrBase64 = data.base64 ?? data.qrcode?.base64 ?? null
  const pairingCode = data.pairingCode ?? data.qrcode?.pairingCode ?? null
  return { qrBase64, pairingCode }
}

export async function getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
  const data = await evo<{ instance?: { state?: string }; state?: string }>(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`
  )
  const state = data.instance?.state ?? data.state
  if (state === 'open' || state === 'connecting' || state === 'close') return state
  return 'unknown'
}

/** The connected WhatsApp number (from ownerJid, e.g. "60123456789@s.whatsapp.net"). */
export async function getInstancePhoneNumber(instanceName: string): Promise<string | null> {
  const data = await evo<unknown>(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`
  )
  // v2 returns an array of instances; v1 wrapped each in { instance: {...} }.
  const list = Array.isArray(data) ? data : [data]
  for (const item of list) {
    const inst = (item as { instance?: { owner?: string; ownerJid?: string } })?.instance ?? item
    const jid = (inst as { ownerJid?: string; owner?: string })?.ownerJid ??
                (inst as { owner?: string })?.owner
    if (typeof jid === 'string' && jid) return jid.split('@')[0]
  }
  return null
}

/** Log the WhatsApp session out (keeps the instance registered). */
export async function logoutInstance(instanceName: string): Promise<void> {
  await evo(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
}

/** Remove the instance from Evolution entirely. */
export async function deleteInstance(instanceName: string): Promise<void> {
  await evo(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
}

import crypto from 'crypto'

const DEFAULT_INVITE_TTL_HOURS = 24

type InvitePayload = {
  v: 1
  uid: string
  email: string
  exp: number
}

export type VerifiedInvite = {
  uid: string
  email: string
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function inviteSecret(): string {
  const secret =
    process.env.USER_INVITE_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY_BASE64 ||
    process.env.FIREBASE_PRIVATE_KEY

  if (!secret) {
    throw new Error('USER_INVITE_SECRET or Firebase private key env is required for invite links')
  }

  return secret
}

function inviteTtlHours(): number {
  const parsed = Number(process.env.USER_INVITE_TTL_HOURS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INVITE_TTL_HOURS
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', inviteSecret()).update(payload).digest('base64url')
}

export function getInviteExpiryHours(): number {
  return inviteTtlHours()
}

export function createInviteToken(uid: string, email: string): string {
  const payload: InvitePayload = {
    v: 1,
    uid,
    email,
    exp: Math.floor(Date.now() / 1000) + inviteTtlHours() * 60 * 60,
  }
  const encoded = base64url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

export function createInviteLink(origin: string, uid: string, email: string): string {
  const url = new URL('/invite', process.env.NEXT_PUBLIC_APP_URL || origin)
  url.searchParams.set('token', createInviteToken(uid, email))
  return url.toString()
}

export function verifyInviteToken(token: string): VerifiedInvite {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) throw new Error('Invalid invite link')

  const expected = sign(encoded)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error('Invalid invite link')
  }

  let payload: InvitePayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as InvitePayload
  } catch {
    throw new Error('Invalid invite link')
  }

  if (payload.v !== 1 || !payload.uid || !payload.email || !payload.exp) {
    throw new Error('Invalid invite link')
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Invite link has expired')
  }

  return { uid: payload.uid, email: payload.email }
}

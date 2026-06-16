import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

// Resolve the service-account private key. Prefer the base64-encoded form
// (FIREBASE_PRIVATE_KEY_BASE64) because env-var panels often mangle the raw
// PEM's newlines/backslashes; base64 only contains panel-safe characters.
// Falls back to the raw FIREBASE_PRIVATE_KEY with literal \n converted.
function getPrivateKey(): string | undefined {
  const b64 = process.env.FIREBASE_PRIVATE_KEY_BASE64
  if (b64) return Buffer.from(b64, 'base64').toString('utf8')
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
}

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  })
}

export const adminAuth = getAuth(getAdminApp())

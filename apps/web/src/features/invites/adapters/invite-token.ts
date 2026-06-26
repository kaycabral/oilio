import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import 'server-only'

const TOKEN_BYTES = 32

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url')
  const hash = hashInviteToken(raw)
  return { raw, hash }
}

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function verifyInviteToken(raw: string, storedHash: string): boolean {
  const candidate = hashInviteToken(raw)
  const a = Buffer.from(candidate, 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

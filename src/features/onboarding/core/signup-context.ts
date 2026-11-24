import { type Attribution, attributionFromParams, isReservedSlug, isValidSlug } from '@/domain'

export type SignupOrgContext = {
  orgSlug: string
  attribution: Attribution
}

export function resolveSignupOrgContext(next: string | null | undefined): SignupOrgContext | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null

  let url: URL
  try {
    url = new URL(next, 'http://x')
  } catch {
    return null
  }

  const read = (key: string): string | null => url.searchParams.get(key)
  const attribution = attributionFromParams(read)

  const from = url.searchParams.get('from')
  if (from && isValidSlug(from) && !isReservedSlug(from)) {
    return { orgSlug: from, attribution }
  }

  const first = url.pathname.split('/').filter(Boolean)[0]
  if (first && isValidSlug(first) && !isReservedSlug(first)) {
    return { orgSlug: first, attribution }
  }

  return null
}

export function buildSignupNext(bookingTarget: string | null): string {
  if (!bookingTarget) return '/signup/done'
  return `/onboarding/profile?next=${encodeURIComponent(bookingTarget)}`
}

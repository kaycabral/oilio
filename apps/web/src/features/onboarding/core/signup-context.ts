import { type Attribution, attributionFromParams, isReservedSlug, isValidSlug } from '@/domain'

// Functional core for resolving the establishment a self-signup belongs to from
// the completion `next` URL (brief 0077 Grupo E / Cenário 3 — #1278). After
// login → completion the visitor returns to the URL that asked them to register;
// that URL carries the org context, so we recover it here to materialize the
// Customer at completion (intent=signup) instead of waiting for the first
// booking. Pure: parses a relative path string, no I/O.
//
// Two link shapes carry the context (see `shared/invite/client-invite.ts`):
//   - signup intent:  /signup[/done]?from={slug}&cbrl_*    → slug from `from`
//   - booking intent: /{slug}/{unitSlug}/book?...&cbrl_*   → slug from path[0]
// Attribution (the cbrl_*/utm_* axes) rides along in both and is captured too.

export type SignupOrgContext = {
  orgSlug: string
  attribution: Attribution
}

// Parse `next` (a same-origin relative path) into the org slug + attribution, or
// null when no establishment context is present (plain platform signup). Invalid
// / reserved slugs resolve to null — a tampered `next` can't smuggle a bogus org.
export function resolveSignupOrgContext(next: string | null | undefined): SignupOrgContext | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null

  // Parse against a dummy origin so URLSearchParams + pathname do the work; the
  // origin is never used (we only read the path + query).
  let url: URL
  try {
    url = new URL(next, 'http://x')
  } catch {
    return null
  }

  const read = (key: string): string | null => url.searchParams.get(key)
  const attribution = attributionFromParams(read)

  // signup intent: the establishment is in `from`.
  const from = url.searchParams.get('from')
  if (from && isValidSlug(from) && !isReservedSlug(from)) {
    return { orgSlug: from, attribution }
  }

  // booking intent: the establishment is the first path segment of /{slug}/…
  const first = url.pathname.split('/').filter(Boolean)[0]
  if (first && isValidSlug(first) && !isReservedSlug(first)) {
    return { orgSlug: first, attribution }
  }

  return null
}

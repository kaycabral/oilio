import { isValidSlug, isValidUnitSlug } from '@/domain'

export const APP_TOP_LEVEL_SEGMENTS: ReadonlySet<string> = new Set([
  'agenda',
  'api',
  'auth',
  'cash',
  'catalog',
  'company',
  'copilot',
  'customers',
  'dashboard',
  'finance',
  'invites',
  'login',
  'me',
  'monitoring-tunnel',
  'notifications',
  'onboarding',
  'opengraph-image',
  'orders',
  'organizations',
  'plans',
  'pricing',
  'privacy',
  'reports',
  'select-unit',
  'settings',
  'signup',
  'subscriptions',
  'team',
  'terms',
  'units',
])

export type PublicPageTarget = { slug: string; unitSlug: string | null }

export type PublicUnitStatus = { slug: string; live: boolean }

export type PublicOrgVisibility = { units: readonly PublicUnitStatus[] } | null

export type PublicPageGateDeps = {
  lookup: (slug: string) => Promise<PublicOrgVisibility>
  timeoutMs?: number
}

export const PUBLIC_PAGE_GATE_TIMEOUT_MS = 1500

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

export function publicPageFromPath(pathname: string): PublicPageTarget | null {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1)
  if (parts.length < 1 || parts.length > 2) return null
  const slug = decodeSegment(parts[0] ?? '')
  if (slug === null || APP_TOP_LEVEL_SEGMENTS.has(slug) || !isValidSlug(slug)) return null
  if (parts.length === 1) return { slug, unitSlug: null }
  const unitSlug = decodeSegment(parts[1] ?? '')
  if (unitSlug === null || !isValidUnitSlug(unitSlug)) return null
  return { slug, unitSlug }
}

function isNotFound(target: PublicPageTarget, org: PublicOrgVisibility): boolean {
  if (!org) return true
  if (target.unitSlug === null) return !org.units.some((u) => u.live)
  return !org.units.some((u) => u.slug === target.unitSlug && u.live)
}

export async function isPublicPageNotFound(
  target: PublicPageTarget,
  deps: PublicPageGateDeps,
): Promise<boolean> {
  const { lookup, timeoutMs = PUBLIC_PAGE_GATE_TIMEOUT_MS } = deps
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const org = await Promise.race([lookup(target.slug), timeout])
    if (org === 'timeout') return false
    return isNotFound(target, org)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

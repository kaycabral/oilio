import type { BeforeSendEvent } from '@vercel/analytics/next'

const PATH_RULES: readonly (readonly string[])[] = [
  '/catalog/new',
  '/plans/new',
  '/subscriptions/new',
  '/units/new',
  '/catalog/[id]',
  '/customers/[id]',
  '/invites/[orgId]/[inviteId]',
  '/orders/[id]',
  '/plans/[id]',
  '/subscriptions/[id]',
  '/team/[userId]',
  '/units/[id]',
].map((rule) => rule.split('/'))

function isPlaceholder(part: string): boolean {
  return part.startsWith('[') && part.endsWith(']')
}

function matches(segments: readonly string[], rule: readonly string[]): boolean {
  return (
    segments.length >= rule.length &&
    rule.every((part, index) => isPlaceholder(part) || part === segments[index])
  )
}

function redactPath(pathname: string): string {
  const segments = pathname.split('/')
  const rule = PATH_RULES.find((candidate) => matches(segments, candidate))
  if (!rule) return pathname
  return segments.map((segment, index) => rule[index] ?? segment).join('/')
}

export function redactAnalyticsUrl(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  return `${parsed.origin}${redactPath(parsed.pathname)}`
}

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = redactAnalyticsUrl(event.url)
  return url === null ? null : { ...event, url }
}

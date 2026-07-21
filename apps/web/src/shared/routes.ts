import type { Route } from 'next'

export function toRoute(href: string): Route {
  return href as Route
}

export function isSafeInternalPath(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  if (!raw.startsWith('/')) return false
  if (raw.startsWith('//')) return false
  if (raw.startsWith('/\\')) return false
  return true
}

export function safeNext(raw: unknown, fallback: Route = '/dashboard'): Route {
  return isSafeInternalPath(raw) ? toRoute(raw) : fallback
}

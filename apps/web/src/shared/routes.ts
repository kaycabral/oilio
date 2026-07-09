import type { Route } from 'next'

export function toRoute(href: string): Route {
  return href as Route
}

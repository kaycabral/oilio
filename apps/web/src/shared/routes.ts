import type { Route } from 'next'

// Typed-route boundary. Next `typedRoutes` brands `Route`; a route built from an
// opaque `string` (NavItem.href from the design system, a `${pathname}?${qs}`
// push, a computed redirect target) can't be statically inferred and has no
// runtime shape to validate against, so `as Route` is irreducible — Next's own
// documented pattern. This is the ONE narrowing assertion in the app: it lives
// only here, and the assertion rules are disabled for this `src/shared/routes.ts`
// seam by the shared Next layer (`@cbrl/eslint-base/configs/next.mjs`). Callers
// pass a string they know is a valid in-app route.
export function toRoute(href: string): Route {
  return href as Route
}

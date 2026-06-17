// Unit-scoping for dashboard reads (brief 0043). A query is scoped to the
// active unit when one is in context; tenant-wide only when there is none
// (tenant without units yet). Pure + Firestore-agnostic so the decision is
// unit-testable without the emulator — the real query round-trip is covered by
// integration/e2e.

// Minimal structural type so a real Firestore `Query` (and a test fake) both
// satisfy it without importing firebase-admin here.
type UnitScopable<Q> = { where(field: 'unitId', op: '==', value: string): Q }

export function scopeByUnit<Q extends UnitScopable<Q>>(query: Q, unitId: string | null): Q {
  return unitId ? query.where('unitId', '==', unitId) : query
}

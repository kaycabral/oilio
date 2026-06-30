// Re-export of the domain-root value objects so existing `@/domain/aggregates`
// call-sites keep working. The canonical home is `src/domain/value-objects.ts`
// (domain root) — placed below `types/` so a read-model type can import the
// shared invariants (`NonEmptyString`, `MoneySchema`) without inverting the
// `aggregates → types` layering. New code should import from `@/domain` or
// `@/domain/value-objects` directly.
export {
  AggregateVersion,
  Money,
  MoneySchema,
  NonEmptyString,
  OrgId,
  OrgIdSchema,
} from '@/domain/value-objects'

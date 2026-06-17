// Functional core for subscription-scope enforcement (briefs 0019/0023). Each
// matcher answers "does this booking violate one axis of the customer's plan
// scope?" from a plain scope view + the booking facts — zero I/O. The adapter
// (enforce-subscription-scope) reads the customer + resolves the scope, then runs
// these in order. `todayIso` is injected (not read from the clock here) so the
// rules stay deterministic and unit-testable.

import { type AllowedTimeScope, isInstantWithinTimeScope } from '@/domain'

/** The slice of a resolved subscription scope the pure matchers read. The repo's
 *  richer result is structurally assignable to this. */
export type SubscriptionScopeView = {
  unitAllowlist: Set<string> | null
  includedCategoryIds: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
}

export type ScopeBlocked = {
  ok: false
  error: string
  rule:
    | 'unitAllowlist'
    | 'allowedTimeScope'
    | 'includedCategoryIds'
    | 'maxPerDay'
    | 'maxConcurrent'
    | 'requireCompleteBeforeNext'
}

/** Spatial axis: the booked unit must be in the plan's allowlist (when set). */
export function checkUnitAllowlist(
  scope: Pick<SubscriptionScopeView, 'unitAllowlist'>,
  unitId: string,
): ScopeBlocked | null {
  if (scope.unitAllowlist && !scope.unitAllowlist.has(unitId)) {
    return {
      ok: false,
      rule: 'unitAllowlist',
      error: 'Unidade fora das permitidas pelo plano do cliente.',
    }
  }
  return null
}

/** Category coverage (brief 0023, AC-06). When the plan restricts coverage to a
 *  category set, the booked service's category must be in it. An uncategorized
 *  service (`null`) can't be covered by a category-restricted plan; an
 *  unrestricted plan (`includedCategoryIds === null`) covers everything. */
export function checkCategoryCoverage(
  scope: Pick<SubscriptionScopeView, 'includedCategoryIds'>,
  serviceCategoryId: string | null | undefined,
): ScopeBlocked | null {
  if (!scope.includedCategoryIds) return null
  const covered =
    serviceCategoryId !== null &&
    serviceCategoryId !== undefined &&
    scope.includedCategoryIds.has(serviceCategoryId)
  if (covered) return null
  return {
    ok: false,
    rule: 'includedCategoryIds',
    error: 'Serviço fora das categorias cobertas pelo plano do cliente.',
  }
}

/** Temporal axis: the instant must fall within the plan's allowed time scope. */
export function checkTimeScope(
  scope: Pick<SubscriptionScopeView, 'allowedTimeScope'>,
  startAt: string,
  tenantTimezone: string,
  todayIso: string,
): ScopeBlocked | null {
  if (!scope.allowedTimeScope) return null
  if (isInstantWithinTimeScope(scope.allowedTimeScope, startAt, tenantTimezone, todayIso))
    return null
  return {
    ok: false,
    rule: 'allowedTimeScope',
    error: 'Horário fora da janela permitida pelo plano do cliente.',
  }
}

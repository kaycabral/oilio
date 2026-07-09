import { type AllowedTimeScope, isInstantWithinTimeScope } from '@/domain'

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

export function checkTimeScope(
  scope: Pick<SubscriptionScopeView, 'allowedTimeScope'>,
  startAt: string,
  orgTimezone: string,
  todayIso: string,
): ScopeBlocked | null {
  if (!scope.allowedTimeScope) return null
  if (isInstantWithinTimeScope(scope.allowedTimeScope, startAt, orgTimezone, todayIso)) return null
  return {
    ok: false,
    rule: 'allowedTimeScope',
    error: 'Horário fora da janela permitida pelo plano do cliente.',
  }
}

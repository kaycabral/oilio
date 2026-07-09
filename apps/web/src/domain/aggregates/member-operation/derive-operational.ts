import type { OperationalStatus } from '@/domain/types/enums'

export type OperationalInputs = {
  readonly inviteAccepted: boolean
  readonly mobile: string | null | undefined
  readonly unitIds: readonly string[]
  readonly catalogServiceIds: readonly string[]
}

export function deriveOperationalStatus(inputs: OperationalInputs): OperationalStatus {
  if (!inputs.inviteAccepted) return 'incomplete'
  const hasMobile = typeof inputs.mobile === 'string' && inputs.mobile.trim().length > 0
  const profileComplete =
    hasMobile && inputs.unitIds.length >= 1 && inputs.catalogServiceIds.length >= 1
  return profileComplete ? 'operational' : 'incomplete'
}

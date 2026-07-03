// Derivation rule for `operationalStatus` (#1047 / brief 0028 AC-06). The status
// is DERIVED from real facts — never written by a UI input. V0 rule:
//
//   operational ⇔ User.mobile present ∧ unitIds.length ≥ 1 ∧ catalogServiceIds.length ≥ 1
//   incomplete  ⇔ otherwise (accepted, but the profile isn't bookable yet)
//
// "Invite accepted" is implied by the memberOperation projection existing (it is
// born only from the accept saga, #1045). So callers that already hold a live
// projection only need to feed identity (mobile) + operational completeness
// (units/services). The pure helper keeps the rule in one place; the server
// emits `member_operation.activated` when it flips to `operational`.

import type { OperationalStatus } from '@/domain/types/enums'

export type OperationalInputs = {
  // Whether the invite was accepted (the projection exists). Callers holding a
  // live projection pass `true`.
  readonly inviteAccepted: boolean
  // The linked User's mobile (canonical contact, #838). Empty/undefined = absent.
  readonly mobile: string | null | undefined
  readonly unitIds: readonly string[]
  readonly catalogServiceIds: readonly string[]
}

export function deriveOperationalStatus(inputs: OperationalInputs): OperationalStatus {
  // The projection exists only after acceptance, so the floor is `incomplete`.
  if (!inputs.inviteAccepted) return 'incomplete'
  const hasMobile = typeof inputs.mobile === 'string' && inputs.mobile.trim().length > 0
  const profileComplete =
    hasMobile && inputs.unitIds.length >= 1 && inputs.catalogServiceIds.length >= 1
  return profileComplete ? 'operational' : 'incomplete'
}

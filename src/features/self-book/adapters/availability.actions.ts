'use server'

import { groupAvailabilityByLocalTime, type AvailabilityRow } from '@/domain'
import { resolveScopeForSessionBySlug } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicAvailability } from './availability'

export type WizardAvailabilityResult =
  | {
      ok: true
      date: string
      rows: AvailabilityRow[]
      memberOperations: Array<{ id: string; name: string }>
    }
  | { ok: false; error: string }

export async function loadUnitAvailability(input: {
  slug: string
  unitSlug: string
  serviceId: string
  date: string
  memberOperationId?: string | null
}): Promise<WizardAvailabilityResult> {
  const scope = await resolveScopeForSessionBySlug(input.slug)
  const bundle = await getPublicAvailability(input.slug, input.unitSlug, {
    serviceId: input.serviceId,
    date: input.date,
    memberOperationId: input.memberOperationId ?? null,
    timeScope: scope?.allowedTimeScope ?? null,
  })
  if (!bundle) return { ok: false, error: 'Disponibilidade indisponível' }
  return {
    ok: true,
    date: bundle.date,
    rows: groupAvailabilityByLocalTime(bundle.slots, bundle.unit.timezone),
    memberOperations: bundle.memberOperations,
  }
}

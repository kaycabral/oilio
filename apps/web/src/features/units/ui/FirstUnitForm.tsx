'use client'

import { defaultFirstUnitHours, defaultFirstUnitName } from '@/features/units/core/unit-defaults'
import { UnitForm } from '@/features/units/ui/UnitForm'

// Guided first-unit form (PRD Identidade v2 / brief 0046, AC-03). Wraps the
// reusable `UnitForm` with the prefilled defaults that reduce onboarding
// friction: the unit name defaults to the Negócio name and the operating week
// is seeded to Mon–Sat 09:00–18:00 (both editable). On submit it runs the same
// `createUnit` saga as `/units/new`, producing a valid v2 Unit
// (agenda = fixed, fiscal = informal) and redirecting into the app.
export function FirstUnitForm({ orgName }: { orgName: string }) {
  return (
    <UnitForm
      defaults={{
        name: defaultFirstUnitName(orgName),
        businessHours: defaultFirstUnitHours(),
      }}
    />
  )
}

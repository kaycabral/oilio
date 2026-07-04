// Active-unit quota helper — extracted from the 'use server' actions module so
// it is NOT exposed as a callable server action (a `'use server'` export becomes
// a POST-reachable action; this is an internal read-side guard, not an action).

import { hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'

// The active-unit quota wall (brief 0072; brief 0088 AC-10 / H1). Free allows a
// single ACTIVE unit; a second one requires `units.unlimited` (Pro+), where
// per-unit billing kicks in. Returns an error string when the quota is exceeded,
// or `null` when the org may add/activate one more unit.
//
// Shared between EVERY path that raises the active-unit count — creation AND
// restore (un-archive). The furo it closes (H1): `archiveUnit(id, false)` only
// checked owner RBAC, so a Pro→Free org with a residual archived unit could
// reactivate it by direct POST and reach 2+ active units past the Free cap.
// Counts ACTIVE units (`listUnitsForOrg` already filters archived).
export async function assertActiveUnitQuota(orgId: string): Promise<string | null> {
  const tier = await getOrgTier(orgId)
  if (hasCapability(tier, 'units.unlimited')) return null
  const activeUnits = await listUnitsForOrg(orgId)
  if (activeUnits.length >= 1) {
    return 'O plano Grátis permite 1 unidade. Faça upgrade para o Pro para adicionar mais.'
  }
  return null
}

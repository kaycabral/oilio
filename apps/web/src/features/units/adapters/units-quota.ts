import { hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'

export async function assertActiveUnitQuota(orgId: string): Promise<string | null> {
  const tier = await getOrgTier(orgId)
  if (hasCapability(tier, 'units.unlimited')) return null
  const activeUnits = await listUnitsForOrg(orgId)
  if (activeUnits.length >= 1) {
    return 'O plano Grátis permite 1 unidade. Faça upgrade para o Pro para adicionar mais.'
  }
  return null
}

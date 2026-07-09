'use client'

import type { Membership, Org, Unit, User } from '@/domain'
import { hasCapability, type Capability } from '@/domain/billing/capabilities'
import type { Tier } from '@/domain/billing/tiers'
import { setActiveOrg as setActiveOrgAction } from '@/shared/org/active-org-actions'
import { setActiveUnit as setActiveUnitAction } from '@/shared/org/active-unit-actions'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

export type OrgOption = { id: string; name: string }

export type OrgContextValue = {
  user: User
  org: Org
  membership: Membership
  tier: Tier
  orgs: OrgOption[]
  units: Unit[]
  activeUnitId: string | null
  unitLocked: boolean
  setActiveUnit: (unitId: string) => Promise<void>
  setActiveOrg: (orgId: string) => Promise<void>
}

const OrgContext = createContext<OrgContextValue | null>(null)

export type OrgProviderValue = Omit<OrgContextValue, 'setActiveUnit' | 'setActiveOrg'>

export function OrgProvider({ value, children }: { value: OrgProviderValue; children: ReactNode }) {
  const router = useRouter()

  const setActiveUnit = useCallback(
    async (unitId: string) => {
      if (unitId === value.activeUnitId) return
      const result = await setActiveUnitAction(unitId)
      if (result.ok) {
        router.refresh()
      }
    },
    [router, value.activeUnitId],
  )

  const setActiveOrg = useCallback(
    async (orgId: string) => {
      if (orgId === value.org.id) return
      const result = await setActiveOrgAction(orgId)
      if (result.ok) {
        router.refresh()
      }
    },
    [router, value.org.id],
  )

  const contextValue = useMemo<OrgContextValue>(
    () => ({ ...value, setActiveUnit, setActiveOrg }),
    [value, setActiveUnit, setActiveOrg],
  )

  return <OrgContext.Provider value={contextValue}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) {
    throw new Error('useOrg called outside OrgProvider')
  }
  return ctx
}

export function useCapability(capability: Capability): boolean {
  const { tier } = useOrg()
  return hasCapability(tier, capability)
}

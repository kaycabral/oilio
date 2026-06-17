'use client'

import type { Membership, Tenant, Unit, User } from '@/domain'
import { setActiveTenant as setActiveTenantAction } from '@/shared/tenant/active-tenant-actions'
import { setActiveUnit as setActiveUnitAction } from '@/shared/tenant/active-unit-actions'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

// Minimal tenant descriptor for the switcher (brief 0029, AC-09). The full
// Tenant doc is only loaded for the active one; the others just need id + name.
export type TenantOption = { id: string; name: string }

export type TenantContextValue = {
  user: User
  tenant: Tenant
  membership: Membership
  // Tenants the user is an active member of (brief 0029, AC-09). One entry per
  // active membership; drives the tenant switcher (shown when 2+).
  tenants: TenantOption[]
  // Units the member can operate (brief 0029). For a single-unit member this
  // is the locked unit only; otherwise every unit of the tenant.
  units: Unit[]
  // Active operational unit, or null when the tenant has no units yet.
  activeUnitId: string | null
  // Whether the member is pinned to a single unit (membership.unitId set). The
  // switcher hides the unit picker and the interstitial never shows (AC-05).
  unitLocked: boolean
  // Switches the active unit: validates + writes the ephemeral cookie
  // server-side, then refreshes so server components re-render scoped to it.
  // No-op-safe — rejects for single-unit members / inaccessible units.
  setActiveUnit: (unitId: string) => Promise<void>
  // Switches the active tenant: writes `currentTenantId` + resets the
  // active-unit cookie so the previous tenant's unit never leaks (AC-09).
  setActiveTenant: (tenantId: string) => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export type TenantProviderValue = Omit<TenantContextValue, 'setActiveUnit' | 'setActiveTenant'>

export function TenantProvider({
  value,
  children,
}: {
  value: TenantProviderValue
  children: ReactNode
}) {
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

  const setActiveTenant = useCallback(
    async (tenantId: string) => {
      if (tenantId === value.tenant.id) return
      const result = await setActiveTenantAction(tenantId)
      if (result.ok) {
        router.refresh()
      }
    },
    [router, value.tenant.id],
  )

  const contextValue = useMemo<TenantContextValue>(
    () => ({ ...value, setActiveUnit, setActiveTenant }),
    [value, setActiveUnit, setActiveTenant],
  )

  return <TenantContext.Provider value={contextValue}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) {
    throw new Error('useTenant called outside TenantProvider')
  }
  return ctx
}

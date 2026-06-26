'use client'

import type { CatalogItem, CatalogItemUnitOverride, StoredUnit } from '@/domain'
import { resolveDefaultNewUnitIds } from '@/features/catalog/core/catalog-item-format'
import { useState, type Dispatch, type SetStateAction } from 'react'

// Imperative shell for the catalog item's multi-unit scope: which units the item
// is offered in (brief 0012) and the per-unit overrides (price/duration/
// commission). Extracted from the form component to keep it thin — the form just
// renders this state. A NEW item defaults to the active unit pre-checked (0039);
// an EDIT keeps the item's stored selection.
export interface CatalogUnitScope {
  readonly selectedUnitIds: Set<string>
  readonly overrides: Record<string, CatalogItemUnitOverride>
  readonly overridesOpen: boolean
  readonly setOverridesOpen: Dispatch<SetStateAction<boolean>>
  readonly toggleUnit: (id: string, checked: boolean) => void
  readonly setOverride: (id: string, patch: CatalogItemUnitOverride | null) => void
}

export function useCatalogUnitScope(
  item: CatalogItem | undefined,
  units: StoredUnit[],
  activeUnitId: string | null,
): CatalogUnitScope {
  const initialUnitIds = new Set(item?.unitIds ?? resolveDefaultNewUnitIds(activeUnitId, units))
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(initialUnitIds)
  const [overrides, setOverrides] = useState<Record<string, CatalogItemUnitOverride>>(
    item?.unitOverrides ?? {},
  )
  const [overridesOpen, setOverridesOpen] = useState<boolean>(
    Object.keys(item?.unitOverrides ?? {}).length > 0,
  )

  function toggleUnit(id: string, checked: boolean): void {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
    // Dropping a unit drops its override too — no orphan overrides for a unit the
    // item no longer serves.
    if (!checked) {
      setOverrides((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  function setOverride(id: string, patch: CatalogItemUnitOverride | null): void {
    setOverrides((prev) => {
      const next = { ...prev }
      if (patch === null || Object.keys(patch).length === 0) {
        delete next[id]
      } else {
        next[id] = patch
      }
      return next
    })
  }

  return {
    selectedUnitIds,
    overrides,
    overridesOpen,
    setOverridesOpen,
    toggleUnit,
    setOverride,
  }
}

'use client'

import type { CatalogItem, CatalogItemKind, Category, StoredUnit } from '@/domain'
import { isCatalogProduct, isCatalogService } from '@/domain'
import { createCatalogItem, updateCatalogItem } from '@/features/catalog/adapters/catalog.actions'
import { formatCents } from '@/features/catalog/core/catalog-item-format'
import {
  CategoryPicker,
  CommissionFieldset,
  KindToggleFieldset,
  PriceAndKindFields,
  ProductNameSection,
  ResourcesOrSkuField,
  UnitScopeFieldset,
  VisibilityFieldset,
} from '@/features/catalog/ui/CatalogItemFields'
import { UnitOverridesFieldset } from '@/features/catalog/ui/CatalogUnitOverrides'
import { useCatalogUnitScope } from '@/features/catalog/ui/use-catalog-unit-scope'
import { useProductCodeAutofill } from '@/features/catalog/ui/use-product-code-autofill'
import { useFormValidity } from '@/hooks/use-form-validity'
import { useOrg } from '@/shared/org/org-context'
import { Button } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function CatalogItemForm({
  kind,
  item,
  units,
  categories,
}: {
  kind: CatalogItemKind
  item?: CatalogItem
  units: StoredUnit[]
  categories: Category[]
}) {
  const router = useRouter()
  const { activeUnitId } = useOrg()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  const initialPrice = item != null ? formatCents(item.priceCents) : ''

  const { selectedUnitIds, overrides, overridesOpen, setOverridesOpen, toggleUnit, setOverride } =
    useCatalogUnitScope(item, units, activeUnitId)
  const autofill = useProductCodeAutofill()

  const [selectedKind, setSelectedKind] = useState<CatalogItemKind>(item?.kind ?? kind)
  const isEdit = item != null
  const resolvedKind: CatalogItemKind = isEdit ? item.kind : selectedKind
  const isService = resolvedKind === 'service'

  const serviceItem = item != null && isCatalogService(item) ? item : undefined
  const productItem = item != null && isCatalogProduct(item) ? item : undefined

  function changeKind(next: CatalogItemKind): void {
    setSelectedKind(next)
    autofill.reset()
  }

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = item
        ? await updateCatalogItem(item.id, formData)
        : await createCatalogItem(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push('/catalog')
    })
  }

  const submitBlocked = selectedUnitIds.size === 0
  const saveLabel = isEdit ? 'Salvar' : 'Criar'
  const submitLabel = pending ? 'Salvando…' : saveLabel
  const activeLabel = isService
    ? 'Ativo (visível em agendamentos)'
    : 'Ativo (disponível para venda)'

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="kind" value={resolvedKind} />

      {isEdit ? null : (
        <KindToggleFieldset
          selectedKind={selectedKind}
          setSelectedKind={changeKind}
          isService={isService}
          refresh={refresh}
        />
      )}

      <ProductNameSection
        isNewProduct={!isEdit && !isService}
        defaultName={item?.name ?? ''}
        autofill={autofill}
      />

      <CategoryPicker categories={categories} initialCategoryId={item?.categoryId ?? null} />

      <PriceAndKindFields
        isService={isService}
        durationDefault={serviceItem?.durationMinutes ?? 30}
        stockDefault={productItem?.stock ?? 0}
        initialPrice={initialPrice}
      />

      <CommissionFieldset commission={item?.commission ?? null} />

      <UnitScopeFieldset units={units} selectedUnitIds={selectedUnitIds} toggleUnit={toggleUnit} />

      {units.length > 1 && selectedUnitIds.size > 0 ? (
        <UnitOverridesFieldset
          units={units}
          selectedUnitIds={selectedUnitIds}
          overrides={overrides}
          setOverride={setOverride}
          overridesOpen={overridesOpen}
          setOverridesOpen={setOverridesOpen}
          isService={isService}
        />
      ) : null}

      <ResourcesOrSkuField
        isService={isService}
        requiredResourcesDefault={serviceItem?.requiredResources.join(', ') ?? ''}
        skuDefault={productItem?.sku ?? ''}
      />

      <VisibilityFieldset
        activeLabel={activeLabel}
        activeDefault={item?.active ?? true}
        publicVisibleDefault={item?.publicVisible ?? false}
        priceOnRequestDefault={item?.priceVisibility === 'on_request'}
      />

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid || submitBlocked}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

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

// A NEW product can autofill from the sovereign base; an EDIT never reopens the
// code field (the reference is immutable by edit — brief 0054 § Ramo paralelo).

// Shared base form for the unified catalog (brief 0023, AC-09). Both the
// service and product variants compose from the SAME component: the common
// commercial fields (name, category picker, price, commission, unit scope +
// per-unit overrides, public visibility, price visibility) live here, and the
// kind-specific block (duration/requiredResources for services, sku/stock for
// products) is injected by the discriminated `kind`. Replaces the previously
// forked ServiceForm/ProductForm. Writes go through the event-sourced
// `catalog/actions.ts` — never a direct Firestore write. Pure derivations live
// in `_lib/catalog-item-format.ts`; the field/override subcomponents in their
// sibling files.

export function CatalogItemForm({
  kind,
  item,
  units,
  categories,
}: {
  // For new items this is only the INITIAL default (e.g. from `?kind=`); the
  // user switches kind inline via the toggle below (AC-09). For edits it is the
  // item's fixed kind — an existing item never changes its discriminator.
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

  // Multi-unit scope (units the item is offered in + per-unit overrides),
  // including the new-item active-unit default (brief 0039/0012).
  const { selectedUnitIds, overrides, overridesOpen, setOverridesOpen, toggleUnit, setOverride } =
    useCatalogUnitScope(item, units, activeUnitId)
  // Product-code autofill (brief 0054). The code field shows only for a NEW
  // product; an edit keeps the existing reference untouched (Ramo paralelo).
  const autofill = useProductCodeAutofill()

  // AC-09: single screen, inline kind selector. New items pick the kind inline
  // (Serviço | Produto) on the same screen — no route-per-kind. Edits keep the
  // item's kind fixed (the discriminator never changes). The hidden `kind`
  // input that drives the server parser follows this state.
  const [selectedKind, setSelectedKind] = useState<CatalogItemKind>(item?.kind ?? kind)
  const isEdit = item != null
  const resolvedKind: CatalogItemKind = isEdit ? item.kind : selectedKind
  const isService = resolvedKind === 'service'

  const serviceItem = item != null && isCatalogService(item) ? item : undefined
  const productItem = item != null && isCatalogProduct(item) ? item : undefined

  // Switching kind discards any product autofill — otherwise a hit's locked
  // (read-only) name would persist onto the service form, blocking the user from
  // naming the service (the ProductCodeField itself only renders for products).
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
      // On success, return to the unified list (mirrors the old service/product
      // create flow which redirected to its index). The list re-queries server
      // side so the new/edited item shows immediately.
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

      {/* The name section owns both autofill bocas (code of C + name combobox of
          D) + the name field. Code/combobox show for a NEW product; a service or
          edit gets the plain name field. */}
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

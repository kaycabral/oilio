'use client'

import type {
  CatalogItem,
  CatalogItemKind,
  CatalogItemUnitOverride,
  Category,
  StoredUnit,
} from '@/domain'
import { isCatalogProduct, isCatalogService } from '@/domain'
import { createCatalogItem, updateCatalogItem } from '@/features/catalog/adapters/catalog.actions'
import {
  COMMISSION_KIND_LABELS,
  commissionKindFor,
  formatCents,
  formatCommissionInput,
  resolveDefaultNewUnitIds,
  type CommissionKind,
} from '@/features/catalog/core/catalog-item-format'
import {
  KindToggleFieldset,
  PriceAndKindFields,
  ResourcesOrSkuField,
  UnitScopeFieldset,
} from '@/features/catalog/ui/CatalogItemFields'
import { UnitOverridesFieldset } from '@/features/catalog/ui/CatalogUnitOverrides'
import { useFormValidity } from '@/hooks/use-form-validity'
import { useOrg } from '@/shared/org/org-context'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

// Radix Select forbids a SelectItem with value="" (empty), so "no category" —
// which the server contract represents as an empty string → null — rides a
// sentinel in the picker and is translated back at the form boundary via the
// hidden `categoryId` input below.
const NO_CATEGORY = '__none'

// Translate the picker sentinel back to the server contract (empty string → null).
function categoryIdForSubmit(value: string): string {
  return value === NO_CATEGORY ? '' : value
}

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
  const [commissionKind, setCommissionKind] = useState<CommissionKind>(
    commissionKindFor(item?.commission),
  )
  const { formRef, isValid, refresh } = useFormValidity()

  const initialPrice = item != null ? formatCents(item.priceCents) : ''
  const initialCommissionValue = formatCommissionInput(item?.commission)

  // AC-03 (brief 0039): a NEW item defaults to the active unit pre-checked
  // while keeping the multi-select (definition stays multi-unit — 0012). An
  // EDIT keeps the item's existing units untouched (`item.unitIds`), so the
  // default never overwrites a stored selection.
  const initialUnitIds = new Set(item?.unitIds ?? resolveDefaultNewUnitIds(activeUnitId, units))
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(initialUnitIds)
  const [overrides, setOverrides] = useState<Record<string, CatalogItemUnitOverride>>(
    item?.unitOverrides ?? {},
  )
  const [overridesOpen, setOverridesOpen] = useState<boolean>(
    Object.keys(item?.unitOverrides ?? {}).length > 0,
  )
  const [categoryValue, setCategoryValue] = useState<string>(item?.categoryId ?? NO_CATEGORY)

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

  function toggleUnit(id: string, checked: boolean): void {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
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
          setSelectedKind={setSelectedKind}
          isService={isService}
          refresh={refresh}
        />
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="catalog-name" className="text-sm font-medium">
          Nome
        </Label>
        <Input
          id="catalog-name"
          name="name"
          defaultValue={item?.name ?? ''}
          required
          minLength={2}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="catalog-category" className="text-sm font-medium">
          Categoria
        </Label>
        <input type="hidden" name="categoryId" value={categoryIdForSubmit(categoryValue)} />
        <Select value={categoryValue} onValueChange={(value) => setCategoryValue(value)}>
          <SelectTrigger id="catalog-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CATEGORY}>Sem categoria</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categories.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            Nenhuma categoria cadastrada. Crie categorias na seção abaixo da lista do catálogo.
          </span>
        ) : null}
      </div>

      <PriceAndKindFields
        isService={isService}
        durationDefault={serviceItem?.durationMinutes ?? 30}
        stockDefault={productItem?.stock ?? 0}
        initialPrice={initialPrice}
      />

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Comissão (padrão)</legend>
        <div className="flex gap-3 py-2">
          {(['none', 'percentage', 'fixed'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="commissionKind"
                value={k}
                checked={commissionKind === k}
                onChange={() => setCommissionKind(k)}
              />
              {COMMISSION_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {commissionKind !== 'none' ? (
          <div className="flex flex-col gap-1 pt-1">
            <Label htmlFor="catalog-commissionValue" className="text-sm font-medium">
              {commissionKind === 'percentage' ? 'Percentual (%)' : 'Valor (R$)'}
            </Label>
            <Input
              id="catalog-commissionValue"
              name="commissionValue"
              type="text"
              inputMode="decimal"
              defaultValue={initialCommissionValue}
              required
            />
          </div>
        ) : null}
      </fieldset>

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

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="active" defaultChecked={item?.active ?? true} />
        {isService ? 'Ativo (visível em agendamentos)' : 'Ativo (disponível para venda)'}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="publicVisible" defaultChecked={item?.publicVisible ?? false} />
        Exibir no catálogo público (landing /{`{slug}`})
      </label>

      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="catalog-priceVisibility"
          name="priceVisibility"
          value="on_request"
          defaultChecked={item?.priceVisibility === 'on_request'}
        />
        <Label htmlFor="catalog-priceVisibility" className="font-normal">
          Preço "sob consulta" no catálogo público
        </Label>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid || submitBlocked}>
          {(() => {
            if (pending) return 'Salvando…'
            return item ? 'Salvar' : 'Criar'
          })()}
        </Button>
      </div>
    </form>
  )
}

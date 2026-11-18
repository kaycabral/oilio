'use client'

import type { CatalogItemKind, Category, CommissionRule, StoredUnit } from '@/domain'
import type { ProductSuggestion } from '@/features/catalog/core/catalog-item-form'
import {
  COMMISSION_KIND_LABELS,
  commissionKindFor,
  formatCommissionInput,
  type CommissionKind,
} from '@/features/catalog/core/catalog-item-format'
import { ProductCodeField } from '@/features/catalog/ui/ProductCodeField'
import type { ProductCodeAutofill } from '@/features/catalog/ui/use-product-code-autofill'
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
} from '@oilio/design'
import { useState } from 'react'

import { ProductNameCombobox } from '@/features/catalog/ui/ProductNameCombobox'

const NO_CATEGORY = '__none'

export function CategoryPicker({
  categories,
  initialCategoryId,
}: {
  categories: Category[]
  initialCategoryId: string | null
}) {
  const [value, setValue] = useState<string>(initialCategoryId ?? NO_CATEGORY)
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="catalog-category" className="text-sm font-medium">
        Categoria
      </Label>
      <input type="hidden" name="categoryId" value={value === NO_CATEGORY ? '' : value} />
      <Select value={value} onValueChange={setValue}>
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
  )
}

export function KindToggleFieldset({
  selectedKind,
  setSelectedKind,
  isService,
  refresh,
}: {
  selectedKind: CatalogItemKind
  setSelectedKind: (k: CatalogItemKind) => void
  isService: boolean
  refresh: () => void
}) {
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Tipo do item</legend>
      <div
        className="flex gap-1 pt-1"
        role="radiogroup"
        aria-label="Tipo do item"
        onChange={refresh}
      >
        {(['service', 'product'] as const).map((k) => (
          <Button
            key={k}
            type="button"
            role="radio"
            aria-checked={selectedKind === k}
            variant={selectedKind === k ? 'default' : 'outline'}
            onClick={() => {
              setSelectedKind(k)
              refresh()
            }}
          >
            {k === 'service' ? 'Serviço' : 'Produto'}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground pt-2 text-xs">
        {isService
          ? 'Serviço: tem duração e recursos. Agendável na agenda.'
          : 'Produto: tem estoque e SKU. Vendido na venda.'}
      </p>
    </fieldset>
  )
}

export function VisibilityFieldset({
  activeLabel,
  activeDefault,
  publicVisibleDefault,
  priceOnRequestDefault,
}: {
  activeLabel: string
  activeDefault: boolean
  publicVisibleDefault: boolean
  priceOnRequestDefault: boolean
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="active" defaultChecked={activeDefault} />
        {activeLabel}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="publicVisible" defaultChecked={publicVisibleDefault} />
        Exibir no catálogo público (landing /{`{slug}`})
      </label>

      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="catalog-priceVisibility"
          name="priceVisibility"
          value="on_request"
          defaultChecked={priceOnRequestDefault}
        />
        <Label htmlFor="catalog-priceVisibility" className="font-normal">
          Preço "sob consulta" no catálogo público
        </Label>
      </div>
    </>
  )
}

export function CommissionFieldset({ commission }: { commission: CommissionRule | null }) {
  const [commissionKind, setCommissionKind] = useState<CommissionKind>(
    commissionKindFor(commission),
  )
  return (
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
            defaultValue={formatCommissionInput(commission)}
            required
          />
        </div>
      ) : null}
    </fieldset>
  )
}

export function CatalogNameField({
  defaultName,
  lockedValue,
  readOnly,
  required,
  isContribution,
  search,
  onClearFill,
}: {
  defaultName: string
  lockedValue: string | null
  readOnly: boolean
  required: boolean
  isContribution: boolean
  search?: {
    suggestions: readonly ProductSuggestion[]
    searching: boolean
    onQuery: (query: string) => void
    onSelect: (suggestion: ProductSuggestion) => void
    onCleared: () => void
    onDismiss: () => void
  }
  onClearFill?: () => void
}) {
  const useCombobox = search != null && !readOnly
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="catalog-name" className="text-sm font-medium">
        Nome
      </Label>
      {useCombobox ? (
        <ProductNameCombobox
          defaultName={defaultName}
          required={required}
          suggestions={search.suggestions}
          searching={search.searching}
          onQuery={search.onQuery}
          onSelect={search.onSelect}
          onCleared={search.onCleared}
          onDismiss={search.onDismiss}
        />
      ) : (
        <Input
          key={lockedValue ?? 'editable-name'}
          id="catalog-name"
          name="name"
          defaultValue={lockedValue ?? defaultName}
          readOnly={readOnly}
          required={required}
          minLength={2}
          aria-describedby={isContribution ? 'catalog-name-hint' : undefined}
        />
      )}
      {readOnly && onClearFill ? (
        <button
          type="button"
          onClick={onClearFill}
          className="text-muted-foreground hover:text-foreground self-start text-xs underline"
        >
          Trocar produto
        </button>
      ) : null}
      {isContribution ? (
        <span id="catalog-name-hint" className="text-muted-foreground text-xs">
          Dê um nome a este produto para cadastrá-lo.
        </span>
      ) : null}
    </div>
  )
}

export function ProductNameSection({
  isNewProduct,
  defaultName,
  autofill,
}: {
  isNewProduct: boolean
  defaultName: string
  autofill: ProductCodeAutofill
}) {
  const nameSearch = isNewProduct
    ? {
        suggestions: autofill.suggestions,
        searching: autofill.searching,
        onQuery: autofill.searchByName,
        onSelect: autofill.selectSuggestion,
        onCleared: autofill.clear,
        onDismiss: autofill.dismissSearch,
      }
    : undefined

  return (
    <>
      {isNewProduct ? (
        <ProductCodeField
          defaultValue=""
          state={autofill.state}
          pending={autofill.pending}
          onLookup={autofill.lookup}
          onCleared={autofill.clear}
        />
      ) : null}

      {autofill.referenceGtin14 !== null ? (
        <input type="hidden" name="gtin" value={autofill.referenceGtin14} />
      ) : null}

      <CatalogNameField
        defaultName={defaultName}
        lockedValue={autofill.filledName}
        readOnly={autofill.locked}
        required={autofill.nameRequired}
        isContribution={autofill.nameIsContribution}
        search={nameSearch}
        onClearFill={autofill.referenceGtin14 !== null ? autofill.clear : undefined}
      />
    </>
  )
}

export function PriceAndKindFields({
  isService,
  durationDefault,
  stockDefault,
  initialPrice,
}: {
  isService: boolean
  durationDefault: number
  stockDefault: number
  initialPrice: string
}) {
  const priceLabel = (
    <div className="flex flex-col gap-1">
      <Label htmlFor="catalog-priceCents" className="text-sm font-medium">
        Preço (R$)
      </Label>
      <Input
        id="catalog-priceCents"
        name="priceCents"
        type="text"
        inputMode="decimal"
        defaultValue={initialPrice}
        placeholder="0,00"
        required
      />
    </div>
  )
  if (isService) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="catalog-durationMinutes" className="text-sm font-medium">
            Duração (min)
          </Label>
          <Input
            id="catalog-durationMinutes"
            name="durationMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={durationDefault}
            required
          />
        </div>
        {priceLabel}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {priceLabel}
      <div className="flex flex-col gap-1">
        <Label htmlFor="catalog-stock" className="text-sm font-medium">
          Estoque atual
        </Label>
        <Input
          id="catalog-stock"
          name="stock"
          type="number"
          min={0}
          defaultValue={stockDefault}
          required
        />
      </div>
    </div>
  )
}

export function ResourcesOrSkuField({
  isService,
  requiredResourcesDefault,
  skuDefault,
}: {
  isService: boolean
  requiredResourcesDefault: string
  skuDefault: string
}) {
  if (isService) {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor="catalog-requiredResources" className="text-sm font-medium">
          Recursos necessários
        </Label>
        <Input
          id="catalog-requiredResources"
          name="requiredResources"
          defaultValue={requiredResourcesDefault}
          placeholder="Separados por vírgula (cadeira-01, secador, …)"
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="catalog-sku" className="text-sm font-medium">
        SKU
      </Label>
      <Input id="catalog-sku" name="sku" defaultValue={skuDefault} placeholder="Opcional" />
    </div>
  )
}

export function UnitScopeFieldset({
  units,
  selectedUnitIds,
  toggleUnit,
}: {
  units: StoredUnit[]
  selectedUnitIds: Set<string>
  toggleUnit: (id: string, checked: boolean) => void
}) {
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Onde é oferecido</legend>
      {units.length === 0 ? (
        <p className="text-destructive text-sm">
          Cadastre ao menos uma unidade em <strong>Unidades</strong> antes de criar itens.
        </p>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          {units.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                name="unitIds"
                value={u.id}
                checked={selectedUnitIds.has(u.id)}
                onCheckedChange={(checked) => toggleUnit(u.id, checked === true)}
              />
              <span>{u.name}</span>
              <span className="text-muted-foreground font-mono text-xs">/{u.slug}</span>
            </label>
          ))}
          {selectedUnitIds.size === 0 ? (
            <p className="text-destructive text-xs">
              Selecione ao menos uma unidade onde o item é oferecido.
            </p>
          ) : null}
        </div>
      )}
    </fieldset>
  )
}

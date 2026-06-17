'use client'

import type { CatalogItemKind, StoredUnit } from '@/domain'
import { Button, Checkbox, Input, Label } from '@cbrl/design'

// Inline Serviço|Produto selector (AC-09) — only for new items; edits keep the
// item's fixed kind. Drives the hidden `kind` input via `selectedKind`.
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

// Price + the kind-specific field (duration for services, stock for products).
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

// Kind-specific trailing field: required resources (service) or SKU (product).
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

// Multi-unit scope checklist — where the item is offered.
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

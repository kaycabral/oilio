'use client'

import type { CatalogItemUnitOverride, StoredUnit } from '@/domain'
import {
  formatCents,
  formatCommissionInput,
  isOverrideCommissionKind,
  overrideCommissionKindFor,
} from '@/features/catalog/core/catalog-item-format'
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'

function UnitOverrideRow({
  unit,
  override,
  setOverride,
  isService,
}: {
  unit: StoredUnit
  override: CatalogItemUnitOverride
  setOverride: (id: string, patch: CatalogItemUnitOverride | null) => void
  isService: boolean
}) {
  const o = override
  const oKind = overrideCommissionKindFor(o)
  return (
    <div className="border-border rounded-md border p-2">
      <p className="text-sm font-medium">{unit.name}</p>
      <div className="grid grid-cols-2 gap-2 pt-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`override-priceCents-${unit.id}`} className="text-xs">
            Preço (R$)
          </Label>
          <Input
            id={`override-priceCents-${unit.id}`}
            name={`override_${unit.id}__priceCents`}
            type="text"
            inputMode="decimal"
            placeholder="herda"
            defaultValue={formatCents(o.priceCents)}
            onChange={(e) => {
              const raw = e.target.value.trim()
              const v =
                raw.length === 0 ? undefined : Math.round(Number(raw.replace(',', '.')) * 100)
              setOverride(unit.id, { ...o, priceCents: v })
            }}
          />
        </div>
        {isService ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`override-durationMinutes-${unit.id}`} className="text-xs">
              Duração (min)
            </Label>
            <Input
              id={`override-durationMinutes-${unit.id}`}
              name={`override_${unit.id}__durationMinutes`}
              type="number"
              min={1}
              max={1440}
              placeholder="herda"
              defaultValue={o.durationMinutes ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                const v = raw.length === 0 ? undefined : Number(raw)
                setOverride(unit.id, { ...o, durationMinutes: v })
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 pt-2">
        <Label htmlFor={`override-commission-${unit.id}`} className="text-xs">
          Comissão
        </Label>
        <Select
          name={`override_${unit.id}__commissionKind`}
          value={oKind}
          onValueChange={(value) => {
            if (!isOverrideCommissionKind(value)) return
            const v = value
            if (v === 'inherit') {
              const next = { ...o }
              delete next.commission
              setOverride(unit.id, next)
            } else if (v === 'none') {
              setOverride(unit.id, { ...o, commission: null })
            } else {
              setOverride(unit.id, { ...o, commission: { kind: v, value: 0 } })
            }
          }}
        >
          <SelectTrigger id={`override-commission-${unit.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Herda do padrão</SelectItem>
            <SelectItem value="none">Sem comissão</SelectItem>
            <SelectItem value="percentage">Percentual</SelectItem>
            <SelectItem value="fixed">Valor fixo</SelectItem>
          </SelectContent>
        </Select>
        {oKind === 'percentage' || oKind === 'fixed' ? (
          <Input
            name={`override_${unit.id}__commissionValue`}
            type="text"
            inputMode="decimal"
            placeholder={oKind === 'percentage' ? 'Percentual (%)' : 'Valor (R$)'}
            defaultValue={formatCommissionInput(o.commission)}
            required
          />
        ) : null}
      </div>
    </div>
  )
}

export function UnitOverridesFieldset({
  units,
  selectedUnitIds,
  overrides,
  setOverride,
  overridesOpen,
  setOverridesOpen,
  isService,
}: {
  units: StoredUnit[]
  selectedUnitIds: Set<string>
  overrides: Record<string, CatalogItemUnitOverride>
  setOverride: (id: string, patch: CatalogItemUnitOverride | null) => void
  overridesOpen: boolean
  setOverridesOpen: (updater: (v: boolean) => boolean) => void
  isService: boolean
}) {
  return (
    <fieldset className="border-border rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">
        <button
          type="button"
          className="text-sm underline-offset-2 hover:underline"
          onClick={() => setOverridesOpen((v) => !v)}
        >
          Exceções por unidade {overridesOpen ? '▾' : '▸'}
        </button>
      </legend>
      {overridesOpen ? (
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-muted-foreground text-xs">
            Sobrescreva preço, duração ou comissão para uma unidade específica. Campo em branco
            herda o valor padrão acima.
          </p>
          {Array.from(selectedUnitIds).map((unitId) => {
            const unit = units.find((u) => u.id === unitId)
            if (!unit) return null
            return (
              <UnitOverrideRow
                key={unitId}
                unit={unit}
                override={overrides[unitId] ?? {}}
                setOverride={setOverride}
                isService={isService}
              />
            )
          })}
        </div>
      ) : null}
    </fieldset>
  )
}

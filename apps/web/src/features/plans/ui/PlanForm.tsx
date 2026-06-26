'use client'

import {
  BILLING_CYCLES,
  type CatalogItem,
  type Category,
  isCatalogService,
  type StoredUnit,
  type SubscriptionPlan,
} from '@/domain'
import { createPlan, updatePlan } from '@/features/plans/adapters/plans.actions'
import {
  CYCLE_LABELS,
  derivePlanFormDefaults,
  type LimitKind,
} from '@/features/plans/core/plan-form-defaults'
import {
  PlanBookingLimitsFieldset,
  PlanTimeScopeFieldset,
} from '@/features/plans/ui/PlanScopeFieldsets'
import { useFormValidity } from '@/hooks/use-form-validity'
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
import { useState, useTransition } from 'react'

export function PlanForm({
  plan,
  units,
  catalogItems,
  categories,
}: {
  plan?: SubscriptionPlan
  units: StoredUnit[]
  catalogItems: CatalogItem[]
  categories: Category[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const d = derivePlanFormDefaults(plan)
  // Plain snapshot reads for the JSX defaultValues (distinct from the toggle
  // states above — these fill the inputs, the toggles gate the fieldsets).
  // `null` (cleared via update) and absent both mean "no restriction" here.
  const initialScope = plan?.allowedTimeScope ?? undefined
  const initialLimits = plan?.bookingLimits ?? undefined
  const [limitKind, setLimitKind] = useState<LimitKind>(d.limitKind)
  const [restrictUnits, setRestrictUnits] = useState<boolean>(d.restrictUnits)
  const initialAllowlist = d.initialAllowlist
  const [restrictDays, setRestrictDays] = useState<boolean>(d.restrictDays)
  const [restrictHours, setRestrictHours] = useState<boolean>(d.restrictHours)
  const [restrictAdvance, setRestrictAdvance] = useState<boolean>(d.restrictAdvance)
  const initialDays = d.initialDays
  const [restrictBookingLimits, setRestrictBookingLimits] = useState<boolean>(
    d.restrictBookingLimits,
  )
  const initialItemIds = d.initialItemIds
  const initialCategoryIds = d.initialCategoryIds

  const { formRef, isValid, refresh } = useFormValidity()

  const initialPrice = d.initialPrice
  const initialQuantity = d.initialQuantity

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = plan ? await updatePlan(plan.id, formData) : await createPlan(formData)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-3"
    >
      {/* ADR 0010, D5 / AC-07 — editar o plano nunca retroage no snapshot
          congelado dos assinantes ativos. Deixa explícito que a edição vale só
          para novas assinaturas; trocar o plano de um assinante atual é ação
          explícita ("trocar plano" na assinatura). */}
      {plan ? (
        <p className="bg-muted/40 text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Alterações valem só para novas assinaturas. Assinantes atuais mantêm o plano contratado —
          para mover um assinante para outro plano, use “Trocar plano” na assinatura dele.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor="plan-name" className="text-sm font-medium">
          Nome do plano
        </Label>
        <Input id="plan-name" name="name" defaultValue={plan?.name ?? ''} required minLength={2} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="plan-description" className="text-sm font-medium">
          Descrição
        </Label>
        <Input
          id="plan-description"
          name="description"
          defaultValue={plan?.description ?? ''}
          placeholder="Opcional"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="plan-priceCents" className="text-sm font-medium">
            Preço (R$)
          </Label>
          <Input
            id="plan-priceCents"
            name="priceCents"
            type="text"
            inputMode="decimal"
            defaultValue={initialPrice}
            placeholder="0,00"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="plan-billing-cycle" className="text-sm font-medium">
            Ciclo
          </Label>
          <Select name="billingCycle" defaultValue={plan?.billingCycle ?? 'monthly'} required>
            <SelectTrigger id="plan-billing-cycle">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {BILLING_CYCLES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CYCLE_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Itens inclusos</legend>
        <p className="text-muted-foreground pb-2 text-xs">
          Selecione os itens (serviço ou produto) cobertos pelo plano. O pacote é exatamente esse
          conjunto de itens granulares.
        </p>
        {catalogItems.length === 0 ? (
          <p className="text-muted-foreground pt-1 text-sm">
            Nenhum item no catálogo — cadastre serviços ou produtos antes de definir a cobertura.
          </p>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {catalogItems.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="includedItemIds"
                  value={item.id}
                  defaultChecked={initialItemIds.has(item.id)}
                />
                <span>{item.name}</span>
                <span className="text-muted-foreground text-xs">
                  ({isCatalogService(item) ? 'Serviço' : 'Produto'})
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Categorias inclusas (conveniência)</legend>
        <p className="text-muted-foreground pb-2 text-xs">
          Atalho opcional: cobre todos os itens da categoria. Não substitui a lista de itens acima.
        </p>
        {categories.length === 0 ? (
          <p className="text-muted-foreground pt-1 text-sm">Nenhuma categoria cadastrada.</p>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {categories.map((category) => (
              <label key={category.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="includedCategoryIds"
                  value={category.id}
                  defaultChecked={initialCategoryIds.has(category.id)}
                />
                {category.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Limite de uso por ciclo</legend>
        <div className="flex gap-3 py-2">
          {(['count', 'unlimited'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="limitKind"
                value={k}
                checked={limitKind === k}
                onChange={() => setLimitKind(k)}
              />
              {k === 'count' ? 'Quantidade fixa' : 'Ilimitado'}
            </label>
          ))}
        </div>
        {limitKind === 'count' ? (
          <div className="flex flex-col gap-1 pt-1">
            <Label htmlFor="plan-limitQuantity" className="text-sm font-medium">
              Quantidade por ciclo
            </Label>
            <Input
              id="plan-limitQuantity"
              name="limitQuantity"
              type="number"
              min={1}
              defaultValue={initialQuantity}
              required
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Unidades cobertas</legend>
        <div className="flex items-center gap-2 py-2 text-sm">
          <Checkbox
            id="plan-restrictUnits"
            name="restrictUnits"
            checked={restrictUnits}
            onCheckedChange={(checked) => setRestrictUnits(checked === true)}
          />
          <Label htmlFor="plan-restrictUnits" className="font-normal">
            Restringir a unidades específicas
          </Label>
        </div>
        {(() => {
          if (!restrictUnits) {
            return (
              <p className="text-muted-foreground pt-1 text-xs">
                Sem restrição — clientes podem agendar em qualquer unidade do org.
              </p>
            )
          }
          if (units.length === 0) {
            return (
              <p className="text-muted-foreground pt-1 text-sm">
                Nenhuma unidade cadastrada — cadastre antes de restringir o plano.
              </p>
            )
          }
          return (
            <div className="flex flex-col gap-2 pt-1">
              {units.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name="unitAllowlist"
                    value={u.id}
                    defaultChecked={initialAllowlist.has(u.id)}
                  />
                  {u.name}
                </label>
              ))}
            </div>
          )
        })()}
      </fieldset>

      <PlanTimeScopeFieldset
        restrictDays={restrictDays}
        setRestrictDays={setRestrictDays}
        restrictHours={restrictHours}
        setRestrictHours={setRestrictHours}
        restrictAdvance={restrictAdvance}
        setRestrictAdvance={setRestrictAdvance}
        initialDays={initialDays}
        initialScope={initialScope}
      />

      <PlanBookingLimitsFieldset
        restrictBookingLimits={restrictBookingLimits}
        setRestrictBookingLimits={setRestrictBookingLimits}
        initialLimits={initialLimits}
      />

      <div className="flex items-center gap-2 text-sm">
        <Checkbox id="plan-active" name="active" defaultChecked={plan?.active ?? true} />
        <Label htmlFor="plan-active" className="font-normal">
          Ativo (disponível para assinatura)
        </Label>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !isValid}>
          {(() => {
            if (pending) return 'Salvando…'
            return plan ? 'Salvar' : 'Criar'
          })()}
        </Button>
      </div>
    </form>
  )
}

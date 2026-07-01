'use client'

import { type BillingCycle, BILLING_CYCLES } from '@/domain'
import type {
  CustomerLite,
  PlanLite,
} from '@/features/subscriptions/adapters/load-subscription-form'
import { createSubscription } from '@/features/subscriptions/adapters/subscriptions.actions'
import { isBillingCycle } from '@/features/subscriptions/core/subscription-form'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
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

const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function SubscriptionForm({
  customers,
  plans,
}: {
  customers: CustomerLite[]
  plans: PlanLite[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? '')
  // Billing cycle follows the selected plan's default (re-derived on plan change)
  // while staying overridable — the plan Select drove the cycle only on mount
  // before, so switching to a monthly plan kept the initial plan's annual cycle.
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    plans[0]?.billingCycle ?? 'monthly',
  )
  const { formRef, isValid, refresh } = useFormValidity()

  const selectedPlan = plans.find((p) => p.id === planId)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createSubscription(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/subscriptions/${res.subscriptionId}`)
      router.refresh()
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
      <div className="flex flex-col gap-1">
        <Label htmlFor="subscription-customer" className="text-sm font-medium">
          Cliente
        </Label>
        <Select name="customerId" required>
          <SelectTrigger id="subscription-customer">
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="subscription-plan" className="text-sm font-medium">
          Plano
        </Label>
        <Select
          name="planId"
          required
          value={planId}
          onValueChange={(value) => {
            setPlanId(value)
            const next = plans.find((p) => p.id === value)
            if (next) setBillingCycle(next.billingCycle)
          }}
        >
          <SelectTrigger id="subscription-plan">
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} — {formatBRL(p.priceCents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Preço do plano EXIBIDO ao operador (brief 0033 AC-09): o server cobra
          min(exibido, vigente) no commit transacional, nunca mais que o exibido. */}
      <input type="hidden" name="displayedPriceCents" value={selectedPlan?.priceCents ?? ''} />

      <div className="flex flex-col gap-1">
        <Label htmlFor="subscription-billing-cycle" className="text-sm font-medium">
          Ciclo de cobrança
        </Label>
        <Select
          name="billingCycle"
          required
          value={billingCycle}
          onValueChange={(value) => {
            if (isBillingCycle(value)) setBillingCycle(value)
          }}
        >
          <SelectTrigger id="subscription-billing-cycle">
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
        <span className="text-muted-foreground text-xs">
          Define o intervalo entre cobranças. Pode diferir do ciclo padrão do plano.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="subscription-startAt" className="text-sm font-medium">
          Início da vigência
        </Label>
        <Input
          id="subscription-startAt"
          name="startAt"
          type="date"
          required
          defaultValue={todayIso()}
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? 'Criando…' : 'Criar assinatura'}
        </Button>
      </div>
    </form>
  )
}

'use client'

import {
  type BillingCycle,
  type Charge,
  type ChargeStatus,
  type Customer,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
  remainingUsage,
} from '@/domain'
import {
  markChargeFailed,
  markChargePaid,
  renewSubscription,
} from '@/features/subscriptions/adapters/subscription-charges.actions'
import {
  cancelSubscription,
  changeSubscriptionPlan,
  reactivateSubscription,
} from '@/features/subscriptions/adapters/subscriptions.actions'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  pending: 'Aguardando 1ª cobrança',
  active: 'Ativa',
  past_due: 'Em recuperação',
  suspended: 'Suspensa',
  cancelled: 'Cancelada',
  cancelled_for_non_payment: 'Cancelada por inadimplência',
}

const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  past_due: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  suspended: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  cancelled_for_non_payment: 'bg-destructive/10 text-destructive',
}

const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

const CHARGE_LABEL: Record<ChargeStatus, string> = {
  scheduled: 'Agendada',
  paid: 'Paga',
  failed: 'Falhou',
  recovering: 'Em recuperação',
  refunded: 'Estornada',
  cancelled: 'Cancelada',
}

const CHARGE_CLASS: Record<ChargeStatus, string> = {
  scheduled: 'bg-muted text-muted-foreground',
  paid: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-destructive/10 text-destructive',
  recovering: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  refunded: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { dateStyle: 'medium' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Management actions (manager-only): renew / cancel / reactivate / change-plan.
// Split out so the detail view stays under the complexity gate.
function SubscriptionActions({
  subscription,
  switchablePlans,
  reason,
  setReason,
  newPlanId,
  setNewPlanId,
  pending,
  error,
  run,
}: {
  subscription: Subscription
  switchablePlans: SubscriptionPlan[]
  reason: string
  setReason: (v: string) => void
  newPlanId: string
  setNewPlanId: (v: string) => void
  pending: boolean
  error: string | null
  run: (action: () => Promise<{ ok: boolean; error?: string }>) => void
}) {
  return (
    <section className="border-border space-y-3 rounded-md border p-4">
      <h2 className="text-sm font-semibold">Ações</h2>
      {subscription.status !== 'cancelled' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => run(() => renewSubscription(subscription.id))}
              disabled={pending}
            >
              Renovar agora
            </Button>
            {subscription.cancelAtPeriodEnd ? (
              <Button
                variant="outline"
                onClick={() => run(() => reactivateSubscription(subscription.id))}
                disabled={pending}
              >
                Cancelar cancelamento
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => run(() => cancelSubscription(subscription.id, reason || null))}
                disabled={pending}
              >
                Cancelar assinatura
              </Button>
            )}
          </div>
          {!subscription.cancelAtPeriodEnd ? (
            <label className="flex flex-col gap-1 pt-1">
              <span className="text-muted-foreground text-xs">
                Motivo (opcional, apenas para histórico)
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: cliente mudou de cidade"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              />
            </label>
          ) : null}

          {/* Troca explícita de plano (ADR 0010, D5 / AC-07). Editar o plano
              nunca move o assinante — esta é a única afford. Captura um snapshot
              fresco do plano de destino; vale daqui pra frente. */}
          <div className="border-border space-y-2 rounded-md border border-dashed p-3">
            <span className="text-sm font-medium">Trocar plano</span>
            <p className="text-muted-foreground text-xs">
              Move o assinante para outro plano a partir de agora. O novo plano é congelado na
              assinatura; a renovação herda o novo plano.
            </p>
            {switchablePlans.length === 0 ? (
              <p className="text-muted-foreground text-xs">Nenhum outro plano ativo disponível.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Label htmlFor="change-plan" className="sr-only">
                  Plano de destino
                </Label>
                <Select value={newPlanId} onValueChange={(value) => setNewPlanId(value)}>
                  <SelectTrigger id="change-plan">
                    <SelectValue placeholder="Selecione um plano…" />
                  </SelectTrigger>
                  <SelectContent>
                    {switchablePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {formatBRL(p.priceCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={pending || !newPlanId}
                  onClick={() => run(() => changeSubscriptionPlan(subscription.id, newPlanId))}
                >
                  Trocar plano
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">Assinatura encerrada.</p>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </section>
  )
}

export function SubscriptionDetail({
  subscription,
  customer,
  charges,
  activePlans,
  canManage,
}: {
  subscription: Subscription
  customer: Customer | null
  charges: Charge[]
  activePlans: SubscriptionPlan[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  // Planos elegíveis pra troca explícita (ADR 0010, D5 / AC-07): ativos e
  // diferentes do contratado. Trocar o plano de um assinante ativo é ação
  // explícita, nunca efeito de editar o plano.
  const switchablePlans = activePlans.filter((p) => p.id !== subscription.plan.planId)
  const [newPlanId, setNewPlanId] = useState('')

  const usage = remainingUsage(subscription.currentPeriod.consumed, subscription.plan.usageLimit)

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Falhou')
    })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{customer?.name ?? 'Cliente removido'}</h1>
          <div role="group" aria-label="Plano atual" className="text-muted-foreground mt-1 text-sm">
            {subscription.plan.name} · {CYCLE_LABEL[subscription.plan.billingCycle]} ·{' '}
            {formatBRL(subscription.plan.priceCents)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASS[subscription.status]}`}
          >
            {STATUS_LABEL[subscription.status]}
          </span>
          {subscription.cancelAtPeriodEnd && subscription.status !== 'cancelled' ? (
            <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
              Cancela ao fim do ciclo
            </span>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Período atual">
          {formatDate(subscription.currentPeriod.startAt)} →{' '}
          {formatDate(subscription.currentPeriod.endAt)}
        </SummaryCard>
        <SummaryCard label="Próxima cobrança">
          {formatDate(subscription.nextChargeDate)}
        </SummaryCard>
        <SummaryCard label="Uso no ciclo">
          {usage == null
            ? 'Ilimitado'
            : `${subscription.currentPeriod.consumed} consumido${
                subscription.currentPeriod.consumed === 1 ? '' : 's'
              } · ${usage} restante${usage === 1 ? '' : 's'}`}
        </SummaryCard>
      </section>

      {canManage ? (
        <SubscriptionActions
          subscription={subscription}
          switchablePlans={switchablePlans}
          reason={reason}
          setReason={setReason}
          newPlanId={newPlanId}
          setNewPlanId={setNewPlanId}
          pending={pending}
          error={error}
          run={run}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Cobranças</h2>
        {charges.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma cobrança ainda.</p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-md border">
            {charges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{formatBRL(c.amountCents)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHARGE_CLASS[c.status]}`}
                    >
                      {CHARGE_LABEL[c.status]}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    Vencimento: {formatDate(c.dueDate)} · Período: {formatDate(c.periodStartAt)} →{' '}
                    {formatDate(c.periodEndAt)}
                    {c.attempts > 0 ? ` · Tentativas: ${c.attempts}` : ''}
                    {c.paidAt ? ` · Paga em ${formatDateTime(c.paidAt)}` : ''}
                    {c.failureReason ? ` · Motivo: ${c.failureReason}` : ''}
                  </div>
                </div>
                {canManage &&
                c.status !== 'paid' &&
                c.status !== 'refunded' &&
                c.status !== 'cancelled' ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run(() => markChargePaid(c.id))}
                      disabled={pending}
                    >
                      Marcar paga
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(() => markChargeFailed(c.id, prompt('Motivo da falha?') ?? null))
                      }
                      disabled={pending}
                    >
                      Marcar falha
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}

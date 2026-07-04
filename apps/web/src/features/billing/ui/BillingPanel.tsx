'use client'

import { type BillingCycle, type Tier } from '@/domain/billing/tiers'
import { cancelSubscription } from '@/features/billing/adapters/cancel.actions'
import { manageBilling, startCheckout } from '@/features/billing/adapters/checkout.actions'
import { track } from '@/shared/lib/track'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Typography,
} from '@cbrl/design'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// Display copy for each tier (the marketing names live in PricingTiers; here we
// only need the short human label for the current-plan badge and the upgrade
// buttons). Keyed by the domain slug so it can never drift from enforcement.
const TIER_LABEL: Record<Tier, string> = {
  free: 'Grátis',
  pro: 'Pro',
  advanced: 'Avançado',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativa',
  trialing: 'Em teste',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  incomplete: 'Incompleta',
}

type BillingPanelProps = {
  tier: Tier
  status: string
  billingCycle: BillingCycle | null
  unitQuantity: number
  unitCount: number
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  hasStripeCustomer: boolean
  // Only the owner can subscribe or open the portal (brief 0073). Managers see
  // the read-only panel; the actions are hidden for them (the server action also
  // enforces owner-only — defense in depth).
  canManageBilling: boolean
  // Scope the cancellation funnel telemetry (brief 0090 § "Eventos"). The
  // `_confirmed` event is emitted server-side by the action; `_intent` (opening
  // the dialog) is emitted here, so the panel needs the org/user ids.
  orgId: string
  userId: string
}

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Self-service billing surface for the Assinatura Oilio (brief 0073, AC-03).
// Shows the current plan, how many units are being charged, the next cycle, and
// the subscribe/manage actions. Per-unit graduated pricing: the charge follows
// the active unit count, so we surface both the count Oilio sees and the count
// Stripe is billing (they converge via the webhook + reconcile cron).
export function BillingPanel({
  tier,
  status,
  billingCycle,
  unitQuantity,
  unitCount,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasStripeCustomer,
  canManageBilling,
  orgId,
  userId,
}: BillingPanelProps) {
  const [pending, startTransition] = useTransition()
  const [cycle, setCycle] = useState<BillingCycle>(billingCycle ?? 'annual')
  const periodEnd = formatPeriodEnd(currentPeriodEnd)
  const isPaid = tier !== 'free'
  // The native cancellation zone shows only for an owner on a live paid
  // subscription that isn't already scheduled to cancel (brief 0090, AC-09).
  const canCancel = canManageBilling && isPaid && hasStripeCustomer && !cancelAtPeriodEnd

  function subscribe(target: Exclude<Tier, 'free'>) {
    startTransition(async () => {
      const form = new FormData()
      form.set('tier', target)
      form.set('cycle', cycle)
      // startCheckout redirects to Stripe on success; it only returns on error.
      const res = await startCheckout(form)
      if (!res.ok) toast.error(res.error)
    })
  }

  function openPortal() {
    startTransition(async () => {
      const res = await manageBilling()
      if (!res.ok) toast.error(res.error)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Typography variant="large">Plano {TIER_LABEL[tier]}</Typography>
          <Badge variant={isPaid ? 'default' : 'outline'}>{STATUS_LABEL[status] ?? status}</Badge>
          {cancelAtPeriodEnd && <Badge variant="outline">Cancela no fim do ciclo</Badge>}
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Unidades neste Negócio</dt>
            <dd className="font-medium">{unitCount}</dd>
          </div>
          {isPaid && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Unidades cobradas</dt>
              <dd className="font-medium">{unitQuantity}</dd>
            </div>
          )}
          {billingCycle && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Ciclo</dt>
              <dd className="font-medium">{billingCycle === 'annual' ? 'Anual' : 'Mensal'}</dd>
            </div>
          )}
          {periodEnd && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">
                {cancelAtPeriodEnd ? 'Acesso até' : 'Próxima cobrança'}
              </dt>
              <dd className="font-medium">{periodEnd}</dd>
            </div>
          )}
        </dl>

        {isPaid && (
          <Typography variant="muted" className="text-xs">
            Cobrança por unidade: a 1ª unidade no preço-base e cada unidade extra com desconto. O
            valor acompanha automaticamente o número de unidades ativas.
          </Typography>
        )}
      </section>

      {canManageBilling && (
        <section className="flex flex-col gap-4 rounded-lg border p-6">
          {hasStripeCustomer ? (
            <>
              <Typography variant="large">Gerenciar assinatura</Typography>
              <Typography variant="muted" className="text-sm">
                Atualize o cartão, troque de plano ou cancele pelo portal seguro do Stripe.
              </Typography>
              <Button onClick={openPortal} disabled={pending} className="w-fit">
                {pending ? 'Abrindo…' : 'Abrir portal de cobrança'}
              </Button>
            </>
          ) : (
            <>
              <Typography variant="large">Assinar um plano</Typography>
              <Typography variant="muted" className="text-sm">
                Desbloqueie assinaturas, comissões, copiloto e relatórios. Você só paga pelas
                unidades que usar.
              </Typography>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Ciclo:</span>
                <Button
                  variant={cycle === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCycle('monthly')}
                >
                  Mensal
                </Button>
                <Button
                  variant={cycle === 'annual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCycle('annual')}
                >
                  Anual (2 meses grátis)
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => subscribe('pro')} disabled={pending}>
                  {pending ? 'Redirecionando…' : 'Assinar o Pro'}
                </Button>
                <Button variant="outline" onClick={() => subscribe('advanced')} disabled={pending}>
                  {pending ? 'Redirecionando…' : 'Assinar o Avançado'}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {canCancel && (
        <CancellationZone tier={tier} periodEnd={periodEnd} orgId={orgId} userId={userId} />
      )}
    </div>
  )
}

// The native cancellation zone (brief 0090, AC-09): a destructive block + the
// confirm AlertDialog. Extracted from BillingPanel so each stays simple and the
// cancel flow (own transition + telemetry) is self-contained. Rendered only when
// the panel decides the owner may cancel a live paid subscription.
function CancellationZone({
  tier,
  periodEnd,
  orgId,
  userId,
}: {
  tier: Tier
  periodEnd: string | null
  orgId: string
  userId: string
}) {
  const [pending, startTransition] = useTransition()

  function confirmCancel() {
    startTransition(async () => {
      const res = await cancelSubscription()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Plano cancelado. Você mantém o acesso até o fim do período pago.')
    })
  }

  return (
    <section className="border-destructive/40 flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <Typography variant="large">Cancelamento</Typography>
        <Typography variant="muted" className="text-sm">
          Ao cancelar, seu plano continua ativo até o fim do período pago
          {periodEnd ? ` (${periodEnd})` : ''}. Depois disso, o Negócio volta para o plano Grátis.
        </Typography>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (open) track('billing_cancel_intent', { org_id: orgId, user_id: userId })
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="w-fit" disabled={pending}>
            Cancelar plano
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar plano</AlertDialogTitle>
            <AlertDialogDescription>
              Você ainda poderá usar o Plano {TIER_LABEL[tier]}
              {periodEnd ? ` até ${periodEnd}` : ' até o fim do período pago'}. Ao final do período,
              o Negócio perde o acesso aos recursos do plano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
            <p className="text-muted-foreground mb-1 font-medium">Você perderá acesso a</p>
            <p className="text-muted-foreground">
              Assinaturas, comissões, copiloto e relatórios — as unidades extras também deixam de
              ser cobradas.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter meu Plano {TIER_LABEL[tier]}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? 'Cancelando…' : 'Cancelar plano'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

'use client'

import { type BillingCycle, type Tier } from '@/domain/billing/tiers'
import { cancelSubscription } from '@/features/billing/adapters/cancel.actions'
import { manageBilling, startCheckout } from '@/features/billing/adapters/checkout.actions'
import type { InvoiceSummary, PaymentMethodSummary } from '@/shared/billing/billing-details'
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
} from '@cbrl/design'
import { CreditCard, Sparkles, Star } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// Display copy for each tier (the marketing names live in PricingTiers; here we
// only need the short human label for the current-plan card and the upgrade
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

const INVOICE_STATUS_LABEL: Record<string, string> = {
  paid: 'Paga',
  open: 'Em aberto',
  void: 'Anulada',
  uncollectible: 'Não paga',
  draft: 'Rascunho',
}

// Card brand → the display name shown next to the masked number. Falls back to a
// capitalized brand for anything Stripe returns that we haven't mapped.
const CARD_BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  elo: 'Elo',
  hipercard: 'Hipercard',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}

type BillingPanelProps = {
  tier: Tier
  status: string
  billingCycle: BillingCycle | null
  unitQuantity: number
  unitCount: number
  orgName: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  hasStripeCustomer: boolean
  // Only the owner can subscribe or open the portal (brief 0073). Managers see
  // the read-only panel; the actions are hidden for them (the server action also
  // enforces owner-only — defense in depth).
  canManageBilling: boolean
  // Live Stripe details (not projected into org_billing). Null/[] when there's no
  // customer yet or Stripe read failed — the panel degrades gracefully.
  paymentMethod: PaymentMethodSummary | null
  invoices: InvoiceSummary[]
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

// Self-service billing surface for the Assinatura Oilio (brief 0073 + 0090).
// Fidelity target: the approved prototype (brief 0090 § Referência visual) — a
// plan card, a payment-method block, an invoices table, and the cancellation
// zone, in that order. Per-unit graduated pricing: the charge follows the active
// unit count, so the plan card surfaces both counts (they converge via webhook).
export function BillingPanel({
  tier,
  status,
  billingCycle,
  unitQuantity,
  unitCount,
  orgName,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasStripeCustomer,
  canManageBilling,
  paymentMethod,
  invoices,
}: BillingPanelProps) {
  const [pending, startTransition] = useTransition()
  const [cycle, setCycle] = useState<BillingCycle>(billingCycle ?? 'annual')
  const periodEnd = formatPeriodEnd(currentPeriodEnd)
  const isPaid = tier !== 'free'
  const canCancel = canManageBilling && isPaid && hasStripeCustomer && !cancelAtPeriodEnd

  function subscribe(target: Exclude<Tier, 'free'>) {
    startTransition(async () => {
      const form = new FormData()
      form.set('tier', target)
      form.set('cycle', cycle)
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

  // Not subscribed yet — the plan card gives way to the subscribe call to action
  // (the prototype's populated layout only applies once there's a paid plan).
  if (!isPaid) {
    return (
      <SubscribeCard
        canManageBilling={canManageBilling}
        cycle={cycle}
        onCycle={setCycle}
        onSubscribe={subscribe}
        pending={pending}
      />
    )
  }

  const contextLine = [
    orgName,
    `${unitCount} ${unitCount === 1 ? 'unidade' : 'unidades'}`,
    periodEnd ? `${cancelAtPeriodEnd ? 'acesso até' : 'renova em'} ${periodEnd}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-8">
      {/* Plan card — icon + name + status badge + context line + "Ajustar plano". */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
            <Star aria-hidden="true" className="size-5" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Typography variant="large">Plano {TIER_LABEL[tier]}</Typography>
              <Badge variant={cancelAtPeriodEnd ? 'outline' : 'default'}>
                {cancelAtPeriodEnd ? 'Cancela no fim do ciclo' : (STATUS_LABEL[status] ?? status)}
              </Badge>
            </div>
            <Typography variant="muted" className="text-sm">
              {contextLine}
            </Typography>
            {unitQuantity !== unitCount && (
              <Typography variant="muted" className="text-xs">
                Stripe cobra {unitQuantity} {unitQuantity === 1 ? 'unidade' : 'unidades'} — ajusta
                no próximo ciclo.
              </Typography>
            )}
          </div>
          {canManageBilling && (
            <Button onClick={openPortal} disabled={pending} className="shrink-0">
              {pending ? 'Abrindo…' : 'Ajustar plano'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Payment method. */}
      <section className="flex flex-col gap-3">
        <Typography variant="large">Pagamento</Typography>
        {paymentMethod ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CreditCard aria-hidden="true" className="text-muted-foreground size-5" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {CARD_BRAND_LABEL[paymentMethod.brand] ?? paymentMethod.brand} ••••{' '}
                  {paymentMethod.last4}
                </span>
                <span className="text-muted-foreground text-xs">
                  Expira {String(paymentMethod.expMonth).padStart(2, '0')}/{paymentMethod.expYear}
                </span>
              </div>
            </div>
            {canManageBilling && (
              <Button variant="outline" onClick={openPortal} disabled={pending}>
                Atualizar
              </Button>
            )}
          </div>
        ) : (
          <Typography variant="muted" className="text-sm">
            Nenhum cartão salvo.
            {canManageBilling ? ' Adicione um pelo portal de cobrança ("Ajustar plano").' : ''}
          </Typography>
        )}
      </section>

      {/* Invoices. */}
      <section className="flex flex-col gap-3">
        <Typography variant="large">Faturas</Typography>
        {invoices.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fatura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{formatDate(inv.date)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatAmount(inv.amount, inv.currency)}
                  </TableCell>
                  <TableCell
                    className={
                      inv.status === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : ''
                    }
                  >
                    {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                  </TableCell>
                  <TableCell className="text-right">
                    {inv.hostedUrl ? (
                      <a
                        href={inv.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Ver
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="muted" className="text-sm">
            Nenhuma fatura ainda.
          </Typography>
        )}
      </section>

      {canCancel && <CancellationZone tier={tier} periodEnd={periodEnd} />}
    </div>
  )
}

// The subscribe call to action shown to a Free org (no paid plan yet).
function SubscribeCard({
  canManageBilling,
  cycle,
  onCycle,
  onSubscribe,
  pending,
}: {
  canManageBilling: boolean
  cycle: BillingCycle
  onCycle: (c: BillingCycle) => void
  onSubscribe: (t: Exclude<Tier, 'free'>) => void
  pending: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4" />
          Assinar um plano
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Typography variant="large">Plano Grátis</Typography>
          <Badge variant="outline">Ativo</Badge>
        </div>
        <Typography variant="muted" className="text-sm">
          Desbloqueie assinaturas, comissões, copiloto e relatórios. Você só paga pelas unidades que
          usar.
        </Typography>
        {canManageBilling ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ciclo:</span>
              <Button
                variant={cycle === 'monthly' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onCycle('monthly')}
              >
                Mensal
              </Button>
              <Button
                variant={cycle === 'annual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onCycle('annual')}
              >
                Anual (2 meses grátis)
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onSubscribe('pro')} disabled={pending}>
                {pending ? 'Redirecionando…' : 'Assinar o Pro'}
              </Button>
              <Button variant="outline" onClick={() => onSubscribe('advanced')} disabled={pending}>
                {pending ? 'Redirecionando…' : 'Assinar o Avançado'}
              </Button>
            </div>
          </>
        ) : (
          <Typography variant="muted" className="text-sm">
            Peça ao dono do Negócio para assinar um plano.
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

// The native cancellation zone (brief 0090, AC-09): a destructive block + the
// confirm AlertDialog. Rendered only when the owner may cancel a live paid
// subscription. The confirm emits `billing_cancel_confirmed` server-side.
function CancellationZone({ tier, periodEnd }: { tier: Tier; periodEnd: string | null }) {
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
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Cancelamento</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <Typography variant="muted" className="max-w-md text-sm">
          Interrompe a cobrança recorrente. Você mantém o acesso até o fim do período pago
          {periodEnd ? ` (${periodEnd})` : ''}.
        </Typography>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={pending}>
              Cancelar plano
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar plano</AlertDialogTitle>
              <AlertDialogDescription>
                Você ainda poderá usar o Plano {TIER_LABEL[tier]}
                {periodEnd ? ` até ${periodEnd}` : ' até o fim do período pago'}. Ao final do
                período, o Negócio perde o acesso aos recursos do plano.
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
      </CardContent>
    </Card>
  )
}

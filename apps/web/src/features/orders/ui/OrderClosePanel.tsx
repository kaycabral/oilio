'use client'

import { type Order, type PaymentMethod, hasSaleItem, PAYMENT_METHODS } from '@/domain'
import {
  closeOrderFormAction,
  undoCloseOrderFormAction,
} from '@/features/orders/adapters/close.actions'
import { formatBRL, PAYMENT_LABEL } from '@/features/orders/core/order-detail-format'
import type { TenantMember } from '@/shared/tenant/membership'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'

const UNDO_CLOSE_WINDOW_MS = 5 * 60 * 1000

export function OrderClosePanel({
  order,
  memberByUserId,
  disabled,
  onDone,
}: {
  order: Order
  memberByUserId: Record<string, TenantMember>
  disabled: boolean
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [state, formAction, pending] = useActionState(closeOrderFormAction, { ok: false })
  // Forma de pagamento só é exigida quando há item de venda (brief 0021 AC-02).
  // Venda 100% coberta pelo plano fecha sem pagamento.
  const sale = hasSaleItem(order.items)
  let paymentSummary = 'Consumo do plano'
  if (sale) paymentSummary = paymentMethod ? PAYMENT_LABEL[paymentMethod] : '—'

  // Fecha o dialog e revalida só quando o backend confirma. Em erro, o dialog
  // permanece aberto com `state.error` inline (AC-03).
  useEffect(() => {
    if (state.ok) {
      setOpen(false)
      toast.success('Venda fechada')
      onDone()
    }
  }, [state.ok, onDone])

  return (
    <div className="border-primary/30 bg-primary/5 grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto]">
      {sale ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-method" className="text-sm font-medium">
            Forma de pagamento
          </Label>
          <Select
            value={paymentMethod}
            onValueChange={(value) => {
              const method = PAYMENT_METHODS.find((m) => m === value)
              if (method) setPaymentMethod(method)
            }}
          >
            <SelectTrigger id="payment-method">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {PAYMENT_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-muted-foreground self-end text-sm">
          Venda 100% coberta pelo plano — fecha sem forma de pagamento.
        </p>
      )}
      <Button
        type="button"
        className="self-end"
        disabled={disabled || (sale && !paymentMethod)}
        onClick={() => setOpen(true)}
      >
        Fechar venda
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="col-span-full">
          <DialogHeader>
            <DialogTitle>Confirmar fechamento</DialogTitle>
            <DialogDescription>
              Revise antes de fechar — gera comissões e registro de venda no caixa.
            </DialogDescription>
          </DialogHeader>

          <ul className="divide-border border-border max-h-60 divide-y overflow-auto rounded-md border text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {memberByUserId[item.attributedUserId]?.name ?? '—'}
                  </span>
                </div>
                <span className="tabular-nums">
                  {item.quantity} × {formatBRL(item.unitPriceCents)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Forma de pagamento</span>
            <span className="font-medium">{paymentSummary}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(order.totalCents)}</span>
          </div>

          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <form action={formAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="paymentMethod" value={paymentMethod} />
              <Button type="submit" disabled={pending}>
                {pending ? 'Fechando…' : 'Confirmar fechamento'}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function UndoClosePanel({
  orderId,
  closedAt,
  onDone,
}: {
  orderId: string
  closedAt: string | null
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState(undoCloseOrderFormAction, { ok: false })

  useEffect(() => {
    if (state.ok) {
      toast.success('Fechamento desfeito')
      onDone()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onDone])

  // AC-09: esconde o botão fora da janela de 5 min (backend revalida mesmo
  // assim). closedAt ausente/inválido → nada a desfazer.
  const closedAtMs = closedAt ? Date.parse(closedAt) : Number.NaN
  if (Number.isNaN(closedAtMs) || Date.now() - closedAtMs > UNDO_CLOSE_WINDOW_MS) {
    return null
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Desfazendo…' : 'Desfazer fechamento'}
      </Button>
    </form>
  )
}

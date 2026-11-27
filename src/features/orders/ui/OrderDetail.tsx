'use client'

import {
  type CatalogProductItem,
  type CatalogServiceItem,
  type Commission,
  type Customer,
  type Order,
  type OrderCoverage,
  isOrderEditable,
} from '@/domain'
import {
  cancelOrder,
  removeItemFromOrder,
  updateItemAttribution,
  updateItemCoverage,
  updateOrderMeta,
} from '@/features/orders/adapters/orders.actions'
import { buildCatalogOptions, statusLine } from '@/features/orders/core/order-detail-format'
import type { OrgMember } from '@/shared/org/membership'
import { formatAmountFromCents, formatBRLFromCents } from '@cbrl/br/money'
import { Button, Input } from '@cbrl/design'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { OrderAddItemForm } from './OrderAddItemForm'
import { OrderClosePanel, UndoClosePanel } from './OrderClosePanel'
import { OrderCommissionsTable } from './OrderCommissionsTable'
import { OrderCustomerSelector } from './OrderCustomerSelector'
import { OrderItemRow } from './OrderItemRow'

export type OrderDetailProps = {
  order: Order
  customer: Customer | null
  services: CatalogServiceItem[]
  products: CatalogProductItem[]
  members: OrgMember[]
  currentUserId: string
  commissions: Commission[]
  subscriptionCoverage: { remaining: number | null } | null
  canCancel: boolean
  customers: Customer[]
  canRegisterCustomer: boolean
}

export function OrderDetail({
  order,
  customer,
  services,
  products,
  members,
  currentUserId,
  commissions,
  subscriptionCoverage,
  canCancel,
  customers,
  canRegisterCustomer,
}: OrderDetailProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const editable = isOrderEditable(order)

  const memberByUserId = useMemo(
    () => Object.fromEntries(members.map((m) => [m.userId, m])),
    [members],
  )

  const catalogOptions = useMemo(
    () => buildCatalogOptions(services, products),
    [services, products],
  )

  function handle<T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T>,
    onSuccess?: (res: T) => void,
  ) {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        toast.error(res.error ?? 'Erro inesperado')
        return
      }
      onSuccess?.(res)
      router.refresh()
    })
  }

  function onRemoveItem(itemId: string) {
    handle(() => removeItemFromOrder(order.id, itemId))
  }

  function onChangeAttribution(itemId: string, attributedUserId: string) {
    handle(() => updateItemAttribution(order.id, itemId, attributedUserId))
  }

  function onChangeCoverage(itemId: string, coverage: OrderCoverage) {
    handle(() => updateItemCoverage(order.id, itemId, coverage))
  }

  function onCancelOrder() {
    if (!confirm('Cancelar esta venda? Não gera registro de venda.')) return
    handle(
      () => cancelOrder(order.id),
      () => router.push('/orders'),
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={'/orders'} className="text-muted-foreground text-xs hover:underline">
            ← Vendas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {order.customerId ? (customer?.name ?? 'Cliente removido') : 'Venda avulsa'}
          </h1>
          {editable ? (
            <div className="mt-2">
              <OrderCustomerSelector
                orderId={order.id}
                customer={customer}
                customers={customers}
                canRegisterCustomer={canRegisterCustomer}
              />
            </div>
          ) : null}
          <p className="text-muted-foreground mt-1 text-sm">
            {statusLine(order)}
            {order.appointmentId ? (
              <>
                {' · '}
                <Link
                  href="/agenda"
                  className="underline underline-offset-2"
                  title="Voltar para a agenda"
                >
                  agendamento vinculado
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {editable ? (
          <div className="flex items-center gap-2">
            {canCancel ? (
              <Button type="button" variant="outline" onClick={onCancelOrder} disabled={pending}>
                Cancelar venda
              </Button>
            ) : null}
          </div>
        ) : null}
        {!editable && order.status === 'closed' && canCancel ? (
          <UndoClosePanel
            orderId={order.id}
            closedAt={order.closedAt}
            onDone={() => router.refresh()}
          />
        ) : null}
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Itens</h2>
        <ul className="divide-border border-border divide-y rounded-md border">
          {order.items.map((item) => (
            <OrderItemRow
              key={item.id}
              item={item}
              members={members}
              memberByUserId={memberByUserId}
              editable={editable}
              pending={pending}
              subscriptionCoverage={subscriptionCoverage}
              onRemove={() => onRemoveItem(item.id)}
              onChangeAttribution={(userId) => onChangeAttribution(item.id, userId)}
              onChangeCoverage={(coverage) => onChangeCoverage(item.id, coverage)}
            />
          ))}
        </ul>
      </section>

      {editable ? (
        <OrderAddItemForm
          orderId={order.id}
          catalogOptions={catalogOptions}
          members={members}
          defaultUserId={currentUserId}
          pending={pending}
          onPending={startTransition}
          onDone={() => router.refresh()}
        />
      ) : null}

      {editable ? (
        <MetaForm
          orderId={order.id}
          discountCents={order.discountCents}
          pending={pending}
          onPending={startTransition}
          onDone={() => router.refresh()}
        />
      ) : (
        <ReadonlyMeta order={order} />
      )}

      <TotalsCard order={order} />

      {editable ? (
        <OrderClosePanel
          order={order}
          memberByUserId={memberByUserId}
          disabled={order.items.length === 0}
          onDone={() => router.refresh()}
        />
      ) : null}

      {commissions.length > 0 ? (
        <OrderCommissionsTable commissions={commissions} memberByUserId={memberByUserId} />
      ) : null}
    </div>
  )
}

function MetaForm({
  orderId,
  discountCents,
  pending,
  onPending,
  onDone,
}: {
  orderId: string
  discountCents: number
  pending: boolean
  onPending: (cb: () => void | Promise<void>) => void
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  function onSubmit(formData: FormData) {
    setError(null)
    onPending(async () => {
      const res = await updateOrderMeta(orderId, formData)
      if (!res.ok) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      toast.success('Venda atualizada')
      onDone()
    })
  }

  return (
    <form action={onSubmit} className="grid gap-3 sm:grid-cols-[200px_auto]">
      <label htmlFor="order-discount" className="flex flex-col gap-1">
        <span className="text-sm font-medium">Desconto (R$)</span>
        <Input
          id="order-discount"
          name="discount"
          inputMode="decimal"
          placeholder="0,00"
          defaultValue={formatAmountFromCents(discountCents)}
        />
      </label>
      <Button type="submit" variant="outline" className="self-end" disabled={pending}>
        Salvar
      </Button>
      {error ? <p className="text-destructive col-span-full text-sm">{error}</p> : null}
    </form>
  )
}

function ReadonlyMeta({ order }: { order: Order }) {
  if (order.discountCents === 0) return null
  return (
    <div className="border-border bg-muted/10 grid gap-2 rounded-md border p-4 text-sm">
      {order.discountCents > 0 ? (
        <div>
          <span className="text-muted-foreground">Desconto aplicado: </span>
          <span className="font-medium tabular-nums">
            {formatBRLFromCents(order.discountCents)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function TotalsCard({ order }: { order: Order }) {
  return (
    <div className="border-border grid gap-1 rounded-md border p-4 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums">{formatBRLFromCents(order.subtotalCents)}</span>
      </div>
      {order.discountCents > 0 ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Desconto</span>
          <span className="text-destructive tabular-nums">
            - {formatBRLFromCents(order.discountCents)}
          </span>
        </div>
      ) : null}
      <div className="border-border mt-1 flex justify-between border-t pt-2 text-base font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatBRLFromCents(order.totalCents)}</span>
      </div>
    </div>
  )
}

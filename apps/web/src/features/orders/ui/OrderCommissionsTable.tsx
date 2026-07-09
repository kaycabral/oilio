'use client'

import { type Commission, type LiquidationStatus, liquidationStatusOf } from '@/domain'
import { formatBRL } from '@/features/orders/core/order-detail-format'
import type { OrgMember } from '@/shared/org/membership'

const LIQUIDATION_LABEL: Record<LiquidationStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
}

const LIQUIDATION_CLASS: Record<LiquidationStatus, string> = {
  pendente: 'bg-amber-100 text-amber-800',
  pago: 'bg-emerald-100 text-emerald-800',
}

export function OrderCommissionsTable({
  commissions,
  memberByUserId,
}: {
  commissions: Commission[]
  memberByUserId: Record<string, OrgMember>
}) {
  const totalCommission = commissions.reduce((acc, c) => acc + c.amountCents, 0)
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Comissões geradas</h2>
      <ul className="divide-border border-border divide-y rounded-md border text-sm">
        {commissions.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-2">
            <div>
              <span className="font-medium">{memberByUserId[c.attributedUserId]?.name ?? '—'}</span>
              <span className="text-muted-foreground"> · {c.itemName}</span>
            </div>
            <div className="text-muted-foreground text-xs">
              {c.commissionKind === 'percentage'
                ? `${c.commissionValue}% de ${formatBRL(c.itemTotalCents)}`
                : 'valor fixo'}
            </div>
            <span
              className={`ml-3 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LIQUIDATION_CLASS[liquidationStatusOf(c)]}`}
            >
              {LIQUIDATION_LABEL[liquidationStatusOf(c)]}
            </span>
            <span className="ml-3 w-24 text-right font-medium tabular-nums">
              {formatBRL(c.amountCents)}
            </span>
          </li>
        ))}
        <li className="bg-muted/40 flex items-center justify-between px-4 py-2 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatBRL(totalCommission)}</span>
        </li>
      </ul>
    </section>
  )
}

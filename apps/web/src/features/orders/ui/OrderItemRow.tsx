'use client'

import { type OrderCoverage, type OrderItem, ORDER_COVERAGES, coverageOf } from '@/domain'
import { attributionLabel, formatBRL } from '@/features/orders/core/order-detail-format'
import type { OrgMember } from '@/shared/org/membership'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'

export function OrderItemRow({
  item,
  members,
  memberByUserId,
  editable,
  pending,
  subscriptionCoverage,
  onRemove,
  onChangeAttribution,
  onChangeCoverage,
}: {
  item: OrderItem
  members: OrgMember[]
  memberByUserId: Record<string, OrgMember>
  editable: boolean
  pending: boolean
  subscriptionCoverage: { remaining: number | null } | null
  onRemove: () => void
  onChangeAttribution: (userId: string) => void
  onChangeCoverage: (coverage: OrderCoverage) => void
}) {
  const lineTotal = item.quantity * item.unitPriceCents
  const attributed = memberByUserId[item.attributedUserId]
  const covered = coverageOf(item) === 'subscription'
  // Cobertura disponível pra qualquer kind (serviço ou produto) com assinatura
  // ativa (brief 0024, AC-04 — produto coberto baixa estoque). A opção "consumo"
  // fica desabilitada quando não há saldo (e o item ainda não está coberto) —
  // caso degenerado do brief 0021. A cobertura real (item ∈ snapshot) é validada
  // no servidor ao marcar/fechar.
  const canCover =
    subscriptionCoverage !== null &&
    (subscriptionCoverage.remaining === null || subscriptionCoverage.remaining > 0 || covered)
  const showCoverage = editable && subscriptionCoverage !== null
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.name}</span>
          <span className="text-muted-foreground text-xs uppercase">
            {item.kind === 'service' ? 'serviço' : 'produto'}
          </span>
          {covered ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
              Consumo do plano
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {item.quantity} × {formatBRL(item.unitPriceCents)}
          {/* Item coberto pelo plano não gera comissão (brief 0079 — covered
              service: no commission). Não anunciar "comissão X%" que não vai
              existir — confundia o operador (#1328). */}
          {item.commission && !covered ? (
            <>
              {' · comissão '}
              {item.commission.kind === 'percentage'
                ? `${item.commission.value}%`
                : formatBRL(item.commission.value)}
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {showCoverage ? (
          <Select
            value={coverageOf(item)}
            onValueChange={(value) => {
              const coverage = ORDER_COVERAGES.find((c) => c === value)
              if (coverage) onChangeCoverage(coverage)
            }}
            disabled={pending}
          >
            <Label htmlFor={`coverage-${item.id}`} className="sr-only">
              Cobertura do item
            </Label>
            <SelectTrigger id={`coverage-${item.id}`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">Venda</SelectItem>
              <SelectItem value="subscription" disabled={!canCover}>
                Consumo do plano
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {editable ? (
          <Select
            value={item.attributedUserId}
            onValueChange={(value) => onChangeAttribution(value)}
            disabled={pending}
          >
            <Label htmlFor={`attribution-${item.id}`} className="sr-only">
              {attributionLabel(item.kind)}
            </Label>
            <SelectTrigger id={`attribution-${item.id}`} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
              {/* Mantém o atual mesmo se ele caiu da lista de membros ativos. */}
              {attributed && !members.some((m) => m.userId === attributed.userId) ? (
                <SelectItem value={attributed.userId}>{attributed.name} (inativo)</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-xs">{attributed?.name ?? '—'}</span>
        )}
        <span className="w-24 text-right font-medium tabular-nums">
          {covered ? (
            <span className="text-muted-foreground text-xs">Plano</span>
          ) : (
            formatBRL(lineTotal)
          )}
        </span>
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={pending}
            aria-label="Remover item"
          >
            ✕
          </Button>
        ) : null}
      </div>
    </li>
  )
}

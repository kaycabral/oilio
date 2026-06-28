'use client'

import {
  liquidationStatusOf,
  type Commission,
  type CommissionReportSummary,
  type CoveredAttendanceSummary,
  type LiquidationStatus,
  type MemberCommissionSummary,
} from '@/domain'
import {
  markCommissionsPaidFormAction,
  type MarkPaidFormState,
} from '@/features/reports/adapters/reports.actions'
import { formString } from '@/shared/form-data'
import { toRoute } from '@/shared/routes'
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useActionState, useId, useTransition } from 'react'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

const STATUS_LABEL: Record<LiquidationStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
}

// Ordem de exibição dos status no resumo.
const STATUS_ORDER: LiquidationStatus[] = ['pendente', 'pago']

// Sentinel para "Todos" — Radix Select proíbe value="". Traduzido na fronteira
// (submit do filtro) de volta para "sem filtro".
const ALL = 'all'

export function CommissionReport({
  commissions,
  summary,
  byMember,
  coveredByMember,
  members,
  memberNameByUserId,
  fromDate,
  toDate,
  fromIso,
  toIso,
  memberFilter,
  statusFilter,
  canMarkPaid,
}: {
  commissions: Commission[]
  summary: CommissionReportSummary
  byMember: MemberCommissionSummary[]
  coveredByMember: CoveredAttendanceSummary[]
  members: { userId: string; name: string }[]
  memberNameByUserId: Record<string, string>
  fromDate: string
  toDate: string
  fromIso: string
  toIso: string
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
  canMarkPaid: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const fromId = useId()
  const toId = useId()
  const paymentProofId = useId()
  const [markState, markAction, marking] = useActionState<MarkPaidFormState, FormData>(
    markCommissionsPaidFormAction,
    { ok: false },
  )

  // O lote "marcar pago" precisa de um membro selecionado (gesto canônico por
  // membro/período) e de ao menos uma comissão pendente no recorte.
  const pendingCount = commissions.filter((c) => liquidationStatusOf(c) === 'pendente').length
  const canBatchPay = canMarkPaid && memberFilter !== null && pendingCount > 0

  function applyFilters(formData: FormData) {
    const next = new URLSearchParams(searchParams.toString())
    for (const key of ['from', 'to', 'member', 'status'] as const) {
      const raw = formString(formData, key).trim()
      const value = raw === ALL ? '' : raw
      if (value) next.set(key, value)
      else next.delete(key)
    }
    startTransition(() => {
      router.push(toRoute(`${pathname}?${next.toString()}`))
    })
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Relatório de comissões</h1>
        <p className="text-muted-foreground text-sm">
          Comissões do período, por membro e status de liquidação.
        </p>
      </header>

      <form action={applyFilters} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor={fromId}>De</Label>
          <Input
            id={fromId}
            type="date"
            name="from"
            defaultValue={fromDate}
            aria-label="De"
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor={toId}>Até</Label>
          <Input
            id={toId}
            type="date"
            name="to"
            defaultValue={toDate}
            aria-label="Até"
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor="commission-member">Membro</Label>
          <Select name="member" defaultValue={memberFilter ?? ALL}>
            <SelectTrigger id="commission-member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor="commission-status">Status</Label>
          <Select name="status" defaultValue={statusFilter ?? ALL}>
            <SelectTrigger id="commission-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Filtrando…' : 'Filtrar'}
        </Button>
      </form>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STATUS_ORDER.filter((s) => summary.byStatus[s].count > 0).map((s) => (
          <div key={s} className="border-border rounded-md border p-3">
            <div className="text-muted-foreground text-xs">{STATUS_LABEL[s]}</div>
            <div className="font-medium tabular-nums">
              {formatBRL(summary.byStatus[s].totalCents)}
            </div>
            <div className="text-muted-foreground text-xs">
              {summary.byStatus[s].count} comissão(ões)
            </div>
          </div>
        ))}
        <div className="bg-muted/40 rounded-md p-3">
          <div className="text-muted-foreground text-xs">Total</div>
          <div className="font-semibold tabular-nums">{formatBRL(summary.totalCents)}</div>
          <div className="text-muted-foreground text-xs">{summary.count} comissão(ões)</div>
        </div>
      </section>

      {/* AC-07 (brief 0030): totais por membro no período — pendente vs. pago.
          A chave é o `userId` do membro; um profissional aparece pela mesma
          identidade. */}
      {byMember.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Por membro</h2>
          <table className="w-full border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="font-normal">Membro</th>
                <th className="text-right font-normal">Pendente</th>
                <th className="text-right font-normal">Pago</th>
                <th className="text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {byMember.map((row) => (
                <tr key={row.attributedUserId} className="border-border">
                  <td className="font-medium">{memberNameByUserId[row.attributedUserId] ?? '—'}</td>
                  <td className="text-right tabular-nums">
                    {formatBRL(row.byStatus.pendente.totalCents)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatBRL(row.byStatus.pago.totalCents)}
                  </td>
                  <td className="text-right font-medium tabular-nums">
                    {formatBRL(row.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* AC-07: atendimentos cobertos por assinatura — contagem + valor de
          catálogo por profissional. Não geram comissão (brief 0021 AC-09); é o
          dado que o dono usa pra ratear o fundo da assinatura por fora. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Atendimentos cobertos por assinatura</h2>
        <p className="text-muted-foreground text-xs">
          Serviços executados com cobertura de assinatura no período. Não geram comissão — base para
          o rateio do fundo da assinatura.
        </p>
        {coveredByMember.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum atendimento coberto no período.</p>
        ) : (
          <table className="w-full border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="font-normal">Profissional</th>
                <th className="text-right font-normal">Atendimentos</th>
                <th className="text-right font-normal">Valor de catálogo</th>
              </tr>
            </thead>
            <tbody>
              {coveredByMember.map((row) => (
                <tr key={row.memberOperationId}>
                  <td className="font-medium">
                    {memberNameByUserId[row.memberOperationId] ?? '—'}
                  </td>
                  <td className="text-right tabular-nums">{row.count}</td>
                  <td className="text-right tabular-nums">{formatBRL(row.catalogValueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* AC-03: lote "marcar pago" por profissional/período — só owner, só com
          um profissional filtrado e pendências no recorte. */}
      {canBatchPay ? (
        <form action={markAction} className="border-border space-y-3 rounded-md border p-4">
          <input type="hidden" name="attributedUserId" value={memberFilter ?? ''} />
          <input type="hidden" name="fromIso" value={fromIso} />
          <input type="hidden" name="toIso" value={toIso} />
          <div className="space-y-1">
            <h2 className="text-sm font-medium">Marcar comissões pendentes como pagas</h2>
            <p className="text-muted-foreground text-xs">
              {pendingCount} comissão(ões) pendente(s) de{' '}
              {memberNameByUserId[memberFilter ?? ''] ?? 'este membro'} no período serão marcadas
              como pagas com a data de hoje.
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor={paymentProofId}>Comprovante (opcional)</Label>
            <Input
              id={paymentProofId}
              type="text"
              name="paymentProof"
              placeholder="Link do comprovante (ex.: print do Pix)"
              aria-label="Comprovante"
              className="max-w-md"
            />
          </div>
          <Button type="submit" disabled={marking}>
            {marking ? 'Marcando…' : 'Marcar pago'}
          </Button>
          {markState.ok && markState.markedCount ? (
            <p className="text-sm text-green-600" role="status">
              {markState.markedCount} comissão(ões) marcada(s) como paga(s).
            </p>
          ) : null}
          {markState.error ? (
            <p className="text-destructive text-sm" role="alert">
              {markState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      <section>
        {commissions.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma comissão no período.</p>
        ) : (
          <ul className="divide-border border-border divide-y rounded-md border text-sm">
            {commissions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <span className="font-medium">
                    {memberNameByUserId[c.attributedUserId] ?? '—'}
                  </span>
                  <span className="text-muted-foreground"> · {c.itemName}</span>
                  <div className="text-muted-foreground text-xs">{formatDate(c.createdAt)}</div>
                </div>
                <span className="text-muted-foreground text-xs">
                  {STATUS_LABEL[liquidationStatusOf(c)]}
                </span>
                <span className="w-24 text-right font-medium tabular-nums">
                  {formatBRL(c.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

import type { FinancePageProps } from '@/features/finance/adapters/load-finance'
import type { BreakEven } from '@/features/finance/core/cuts'
import { formatBrl } from '@/features/finance/core/format'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Typography,
} from '@cbrl/design'
import { FIXED_COST_CATEGORY_LABELS, FixedCostForm } from './FixedCostForm'
import { FixedCostRowActions } from './FixedCostRowActions'

export function FinanceView(props: FinancePageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Typography variant="pageTitle">Financeiro</Typography>
        <Typography variant="muted">Custos fixos e ponto de equilíbrio da unidade.</Typography>
      </div>

      {props.hasActiveUnit ? (
        <>
          <BreakEvenCard breakEven={props.breakEven} />
          <div className="grid gap-6 md:grid-cols-2">
            <FixedCostList fixedCosts={props.fixedCosts} />
            <Card>
              <CardHeader>
                <CardTitle>Adicionar custo fixo</CardTitle>
                <CardDescription>Aluguel, salários, luz… vale por mês.</CardDescription>
              </CardHeader>
              <CardContent>
                <FixedCostForm unitId={props.unitId} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <EmptyState
          title="Nenhuma unidade ativa"
          description="Cadastre uma unidade para começar a registrar custos fixos."
        />
      )}
    </div>
  )
}

function BreakEvenCard({ breakEven }: { breakEven: BreakEven }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ponto de equilíbrio</CardTitle>
        <CardDescription>Quanto vender no mês para se pagar.</CardDescription>
      </CardHeader>
      <CardContent>
        {breakEven.computable ? (
          <div className="flex flex-col gap-1">
            <Typography variant="large">
              Pra se pagar, venda {formatBrl(breakEven.breakEvenRevenueCents)}/mês
            </Typography>
            <Typography variant="muted">
              Custo fixo {formatBrl(breakEven.fixedCostCents)} ÷ margem{' '}
              {Math.round(breakEven.marginRatio * 100)}%
            </Typography>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Typography variant="muted">
              Indisponível — cadastre e venda para calcular a margem.
            </Typography>
            <Typography variant="muted">
              Custo fixo cadastrado: {formatBrl(breakEven.fixedCostCents)}.
            </Typography>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FixedCostList({
  fixedCosts,
}: {
  fixedCosts: Extract<FinancePageProps, { hasActiveUnit: true }>['fixedCosts']
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custos fixos</CardTitle>
        <CardDescription>Vigentes na unidade.</CardDescription>
      </CardHeader>
      <CardContent>
        {fixedCosts.length === 0 ? (
          <EmptyState
            title="Nenhum custo fixo"
            description="Adicione o primeiro custo fixo para ver o ponto de equilíbrio."
          />
        ) : (
          <ul className="flex flex-col divide-y">
            {fixedCosts.map((cost) => (
              <li key={cost.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex flex-col">
                  <span className="font-medium">{cost.name}</span>
                  <Badge variant="secondary" className="w-fit">
                    {FIXED_COST_CATEGORY_LABELS[cost.category]}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatBrl(cost.amountCents)}</span>
                  <FixedCostRowActions cost={cost} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

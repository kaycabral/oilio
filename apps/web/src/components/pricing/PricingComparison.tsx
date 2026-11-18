import { Badge, Typography } from '@oilio/design'
import { Check, Minus } from 'lucide-react'

const COLUMNS = ['Grátis', 'Pro', 'Avançado', 'Escala'] as const

type Cell = boolean | 'soon' | { text: string }

type Feature = {
  label: string
  cells: readonly [Cell, Cell, Cell, Cell]
}

type Group = {
  title: string
  features: readonly Feature[]
}

const GROUPS: readonly Group[] = [
  {
    title: 'Agenda e atendimento',
    features: [
      { label: 'Agenda, bloqueios e atendimentos', cells: [true, true, true, true] },
      { label: 'Comanda e fechamento de venda', cells: [true, true, true, true] },
      { label: 'Caixa e cadastros (clientes, serviços, equipe)', cells: [true, true, true, true] },
      { label: 'Agendamento online pelo cliente', cells: [true, true, true, true] },
    ],
  },
  {
    title: 'Recorrência e receita',
    features: [
      { label: 'Planos e assinaturas (recorrência)', cells: [false, true, true, true] },
      { label: 'Copiloto: meta mensal de lucro', cells: [false, true, true, true] },
    ],
  },
  {
    title: 'Comissão e relatórios',
    features: [
      { label: 'Comissão por membro da equipe e repasse', cells: [false, true, true, true] },
      { label: 'Relatórios de vendas e comissões', cells: [false, true, true, true] },
      {
        label: 'Relatórios consolidados de várias unidades',
        cells: [false, false, 'soon', 'soon'],
      },
    ],
  },
  {
    title: 'Unidades e equipe',
    features: [
      {
        label: 'Unidades',
        cells: [
          { text: '1 unidade' },
          { text: 'Ilimitadas' },
          { text: 'Ilimitadas' },
          { text: 'Ilimitadas' },
        ],
      },
      {
        label: 'Membros da equipe',
        cells: [
          { text: 'Você + 1' },
          { text: 'Ilimitados' },
          { text: 'Ilimitados' },
          { text: 'Ilimitados' },
        ],
      },
      { label: 'Vários negócios num login', cells: [true, true, true, true] },
    ],
  },
  {
    title: 'Automação financeira',
    features: [
      { label: 'Cobrança recorrente automática', cells: [false, false, 'soon', 'soon'] },
      { label: 'Divisão automática do pagamento', cells: [false, false, 'soon', 'soon'] },
      { label: 'Conciliação de caixa e recebimentos', cells: [false, false, 'soon', 'soon'] },
    ],
  },
  {
    title: 'Suporte e atendimento',
    features: [
      {
        label: 'Suporte',
        cells: [
          { text: 'Padrão' },
          { text: 'Padrão' },
          { text: 'Prioritário' },
          { text: 'Prioritário' },
        ],
      },
      { label: 'Implantação com apoio dedicado', cells: [false, false, false, true] },
      { label: 'Condições comerciais negociadas', cells: [false, false, false, true] },
    ],
  },
] as const

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check aria-label="Incluído" className="text-foreground/70 size-4" strokeWidth={2.5} />
        <span className="sr-only">Incluído</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <Minus aria-label="Não incluído" className="text-muted-foreground/40 size-4" />
        <span className="sr-only">Não incluído</span>
      </>
    )
  }
  if (value === 'soon') {
    return (
      <Badge variant="outline" className="text-muted-foreground/70 font-normal">
        Em breve
      </Badge>
    )
  }
  return <span className="text-muted-foreground text-sm">{value.text}</span>
}

export function PricingComparison() {
  return (
    <section className="flex flex-col gap-8 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Compare os planos
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          Tudo que cada plano libera, lado a lado. Comece no Grátis e ative o resto conforme cresce.
        </Typography>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="w-[34%] py-4 pr-4 align-bottom">
                <span className="sr-only">Recurso</span>
              </th>
              {COLUMNS.map((col) => (
                <th key={col} className="px-3 py-4 text-center align-bottom">
                  <Typography as="span" variant="large" className="text-base">
                    {col}
                  </Typography>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((group) => (
              <GroupRows key={group.title} group={group} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function GroupRows({ group }: { group: Group }) {
  return (
    <>
      <tr>
        <th
          colSpan={COLUMNS.length + 1}
          className="text-muted-foreground border-b pt-8 pb-2 text-left text-xs font-semibold tracking-wide uppercase"
        >
          {group.title}
        </th>
      </tr>
      {group.features.map((feature) => (
        <tr key={feature.label} className="border-border/60 border-b">
          <td className="py-3 pr-4 align-middle">
            <span className="text-sm">{feature.label}</span>
          </td>
          {feature.cells.map((cell, i) => (
            <td key={COLUMNS[i]} className="px-3 py-3 text-center align-middle">
              <span className="flex items-center justify-center">
                <CellValue value={cell} />
              </span>
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

import { Badge, Typography } from '@cbrl/design'
import { Check, Minus } from 'lucide-react'

// Tabela comparativa Plans × Features (padrão Notion): agrupa as capacidades por
// categoria e mostra, coluna a coluna, o que cada Plano Oilio libera. É a visão
// "linha a linha" que complementa os cards — o cliente confere o detalhe sem
// abrir o app.
//
// FONTE DA VERDADE: cada célula reflete o que o tier realmente libera hoje
// (@/domain/billing/capabilities → TIER_CAPABILITIES) ou o que está no roadmap
// ("Em breve", brief 0070 AC-04 — roadmap, não capability). A ordem das colunas
// segue TIER_ORDER + o tier de contato "Escala" no fim. Se packaging e
// enforcement divergirem, o drift guard de PricingTiers (tiersMatchDomain) falha
// primeiro; aqui a honestidade é manual e revisada junto.
//
// Colunas: Grátis · Pro · Avançado · Escala. Ordem idêntica aos cards.
const COLUMNS = ['Grátis', 'Pro', 'Avançado', 'Escala'] as const

// Estado de uma célula: incluído (✓), ausente (—), roadmap ("Em breve") ou texto
// literal (ex.: "1 unidade"). O texto é encapsulado em `{ text }` pra o union não
// colapsar `'soon'`/`true` num `string` genérico (mantém a checagem exaustiva).
type Cell = boolean | 'soon' | { text: string }

type Feature = {
  label: string
  // Uma entrada por coluna, na ordem de COLUMNS.
  cells: readonly [Cell, Cell, Cell, Cell]
}

type Group = {
  title: string
  features: readonly Feature[]
}

// Herança de tier é cumulativa (Pro ⊃ Grátis, Avançado ⊃ Pro, Escala ⊃ Avançado),
// então uma linha "incluída no Pro" também marca Avançado e Escala. As células
// abaixo já expandem essa herança explicitamente pra a tabela ser lida sem
// pressupor a regra.
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
      // "Membros da equipe" substitui as antigas linhas "Profissionais" (redundante
      // — tudo é Membership) e "Equipe com papéis (RBAC)" (jargão + o gate de papéis
      // por plano NÃO existe no código, era drift). O limite "Você + 1" no Grátis
      // (o dono + 1 = 2 no total) é uma PROMESSA anunciada antes do enforcement: o
      // gate de contagem de membros ainda será construído (feature Lyra pendente —
      // createInvite conta membros e barra no Grátis). Até lá, membros são
      // tecnicamente ilimitados; a divergência é consciente e rastreada.
      {
        label: 'Membros da equipe',
        cells: [
          { text: 'Você + 1' },
          { text: 'Ilimitados' },
          { text: 'Ilimitados' },
          { text: 'Ilimitados' },
        ],
      },
      // Multi-negócio é diferencial raro no mercado (gerenciar negócios DIFERENTES
      // num login, cada um com seu plano) — incluso em TODOS os planos, até o
      // Grátis. Distinto de multi-unidade (filiais do mesmo negócio). Vendido com
      // palco na landing (MultiBusiness); aqui aparece como linha ✓ pra reforçar
      // que vem de graça.
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

      {/* A tabela rola horizontalmente no mobile (overflow-x) sem quebrar o layout
          da página — as 4 colunas de plano não cabem numa tela estreita, então o
          contêiner é quem rola, nunca o body (regra de Artifact/responsividade). */}
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

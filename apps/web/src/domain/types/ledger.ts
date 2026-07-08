import { Schema } from 'effect'

import { MoneySchema } from '@/domain/value-objects'

// O Razão dimensional (brief 0091, feature-pai A da iniciativa Gestão
// Financeira). Um `LedgerEntry` é um fato financeiro **dimensionado** — a
// unidade da qual qualquer corte financeiro deriva (DRE-MC, lucro, ponto de
// equilíbrio, por unidade), sem cada corte somar fontes soltas.
//
// O Razão deriva do EVENT STREAM imutável por competência, não das projeções e
// não como aggregate ES novo (ADR 0016 D4): os fatos já são eventos
// (`order.closed`, `commission`, `charge.*`, reversões). A `classify` (em
// `@/domain/utils/ledger`) mapeia cada fato do stream pra `LedgerEntry` — nenhum
// evento de razão emitido, nenhum dual-write (ADR 0010 D4). Por isso este tipo
// NÃO mapeia uma projeção Postgres própria: não há tabela `ledger`. A projeção
// existente é cache reconstruível, nunca a autoridade do Razão.
//
// As 3 dimensões são canônicas na Linguagem § "Finanças — um Razão, vários
// cortes". Etiquetadas na origem com defaults — o dono nunca classifica à mão.

// Natureza/função do fato. Nasce completa (cobre o que B/C/E vão popular), ainda
// que a fundação só emita `revenue` e `csp` a partir dos fatos existentes.
// - revenue: entrada de venda (avulsa `order` ou recorrente `charge` liquidada)
// - cmv: custo do produto revendido (Onda 2 — feature E)
// - csp: custo do serviço prestado (comissão = custo direto; insumos na E)
// - expense_*: despesa fixa/operacional por função (Onda 1 — feature B)
// - tax_on_sale / tax_on_profit: imposto (Onda 1 — feature C)
export const LEDGER_NATURES = [
  'revenue',
  'cmv',
  'csp',
  'expense_commercial',
  'expense_admin',
  'expense_financial',
  'tax_on_sale',
  'tax_on_profit',
] as const
export const LedgerNature = Schema.Literal(...LEDGER_NATURES)
export type LedgerNature = typeof LedgerNature.Type

// Comportamento do custo/receita — o eixo da DRE gerencial (MC). `variable` é
// atrelado à venda (comissão, MDR, CMV, imposto s/ venda); `fixed` independe do
// volume (aluguel, salário). Receita é sempre `variable` no sentido de "existe
// com a venda". Sem rateio — a MC classifica por comportamento, nunca distribui
// fixo entre itens (Linguagem § DRE gerencial).
export const LEDGER_BEHAVIORS = ['variable', 'fixed'] as const
export const LedgerBehavior = Schema.Literal(...LEDGER_BEHAVIORS)
export type LedgerBehavior = typeof LedgerBehavior.Type

// A que o fato se vincula. `item` é a granularidade base (o `OrderItem` já tem
// id próprio e a comissão já aponta pra ele); `sale` é o fallback pra fatos sem
// item natural (`charge` de assinatura); `unit` é custo no nível da unidade
// (feature B). Sem vínculo de item = sem rateio implícito.
export const LEDGER_LINKS = ['item', 'sale', 'unit'] as const
export const LedgerLink = Schema.Literal(...LEDGER_LINKS)
export type LedgerLink = typeof LedgerLink.Type

// A fonte-de-origem do fato, pra rastrear/auditar de onde o entry veio sem
// reabrir a projeção. `order`/`commission`/`charge`/`cash_movement` são os fatos
// existentes que a fundação lê; `manual` é o que B/C introduzem (custo digitado).
export const LEDGER_SOURCES = ['order', 'commission', 'charge', 'cash_movement', 'manual'] as const
export const LedgerSource = Schema.Literal(...LEDGER_SOURCES)
export type LedgerSource = typeof LedgerSource.Type

// Um fato financeiro dimensionado. Imutável e aditivo: uma reversão (estorno) é
// um novo `LedgerEntry` cuja `direction` reflete a saída — nunca reescreve um
// entry passado (espelha `cash-movement`: valor positivo, sinal na direção).
export const LedgerEntry = Schema.Struct({
  // `${source}:${sourceId}[:${itemId}]` — determinístico a partir do fato de
  // origem, pra o Razão ser idempotente na releitura (mesma fonte → mesmo id).
  id: Schema.String,
  orgId: Schema.String,
  // Unidade à qual o fato pertence (todo fato financeiro é de uma unidade).
  unitId: Schema.String,
  // As 3 dimensões canônicas.
  nature: LedgerNature,
  behavior: LedgerBehavior,
  link: LedgerLink,
  // Valor sempre positivo (centavos); `direction` carrega o sinal.
  amountCents: MoneySchema,
  // `in` = entra no resultado (receita); `out` = sai (custo/despesa/estorno de
  // receita). Uma reversão de venda é `revenue` + `out`.
  direction: Schema.Literal('in', 'out'),
  // Rastro pro fato de origem — sem FK (leitura derivada), é referência de
  // auditoria, não integridade de banco.
  source: LedgerSource,
  sourceId: Schema.String,
  // Item da order quando `link === 'item'`; null pros fatos sem item.
  itemId: Schema.NullOr(Schema.String),
  // COMPETÊNCIA do fato (ISO) — a data do fato gerador (venda no `closedAt`,
  // assinatura na competência do período de serviço), NÃO a data de gravação
  // (`created_at`) nem de emissão do envelope. É por competência que o Razão
  // bucketiza o período, no fuso da unidade (regime de competência, ADR 0016 D1).
  occurredAt: Schema.String,
})
export type LedgerEntry = typeof LedgerEntry.Type

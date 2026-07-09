# ADR 0016 — Reconhecimento de receita por competência (o Razão é o event stream, não a projeção)

- **Status**: accepted
- **Date**: 2026-07-08
- **Deciders**: kaycabral
- **Briefs**: [0091 — Razão dimensional (fundação)](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0091-razao-dimensional-fundacao) (materializa esta ADR — a fundação da iniciativa Gestão Financeira)
- **PRD upstream**: [Gestão Financeira do Negócio](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Gestao-Financeira) (esta ADR fixa a regra contábil que rege o Razão, o corte DRE-MC e o Copiloto)
- **Related ADRs**: [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (fronteira ES + PII fora do payload — habilita ler o stream financeiro sem vazar PII) · [0012-relational-event-store-persistence-port](0012-relational-event-store-persistence-port.md) (o `PersistencePort`/event store é a fonte que esta ADR consome por competência) · [0009-timezone-two-clocks](0009-timezone-two-clocks.md) (competência é a data do fato no fuso da unidade, não wall-clock de append)

## Context

A iniciativa Gestão Financeira precisa de um **Razão** (general ledger) do qual qualquer corte financeiro deriva — DRE gerencial (margem de contribuição), lucro, ponto de equilíbrio. A primeira implementação (brief 0091, MR !1387) derivou o Razão das **projeções-snapshot** (`orders`/`commissions`/`charges`), e um code-review adversarial de alto esforço achou 7 defeitos de correção com uma raiz comum: **a projeção é mutável e reflete estado atual, não o histórico de fatos econômicos**. Casos concretos:

- Uma comanda reaberta faz a projeção `orders` voltar `closed_at` a `null`; um read por `WHERE status='closed'` **apaga a venda original do Razão retroativamente**.
- A receita de assinatura era reconhecida na data do **pagamento** (`paidAt`), não da prestação do serviço — regime de caixa disfarçado de DRE.
- Um refund (`status='refunded'`) apagava receita de um período fechado, sem lançamento de contrapartida nem trilha.

O produto não tinha decisão canônica sobre **regime contábil** (competência × caixa), **reconhecimento de receita** (venda avulsa × assinatura), **estorno** (apagar × contrapartida) nem **fonte de verdade** do Razão. Esta ADR é a primeira e rege tudo a jusante.

Fundamentação contábil (parecer de controller, grounded em IFRS/CPC): a DRE é **competência (accrual)** por definição — o que é caixa chama-se DFC. Receita se reconhece quando a **obrigação de performance é satisfeita** (IFRS 15 / CPC 47), não quando o dinheiro entra. Um livro-razão é **append-only** por natureza (trilha de auditoria; período fechado é imutável — retifica-se por lançamento no período corrente, nunca sobrescrevendo o passado).

## Decision

### 1. Regime: competência (accrual), não caixa

O Razão e todo corte de **Lucro** operam em **regime de competência**: cada fato econômico é reconhecido na competência do **fato gerador** (prestação do serviço / decurso do período coberto), **nunca na data do dinheiro**. Fluxo de caixa/liquidez é sistema separado (os três sistemas canônicos — Receita · Lucro · Caixa — não se misturam; ver [[Linguagem]] § Meta e alavancas).

### 2. Reconhecimento de receita, por fonte

| Fonte                      | Obrigação de performance                                                         | Competência (quando reconhecer)                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Venda avulsa** (comanda) | satisfeita no ponto da **prestação/venda** (serviço executado, produto entregue) | data do fechamento da comanda (`order.closed.closedAt`) — não quando o cliente paga                                                                                                                                                                      |
| **Assinatura** (charge)    | satisfeita **ao longo do período coberto** (acesso/serviço _over time_, IFRS 15) | **pro-rata ao longo de `[periodStartAt, periodEndAt]`**, não na data da cobrança. A cobrança antecipada é _deferred revenue_ (passivo), apropriada ao longo do período. `status='paid'` é o gate de realização; a alocação é por competência do serviço. |

> **Escolha de V0 (não erro).** Em ciclo de assinatura **mensal alinhado ao mês-calendário**, competência ≈ caixa e a alocação pro-rata degenera para 1 lançamento no mês — pode-se shipar assim. A divergência aparece em ciclo **anual ou atrasado**; o pro-rata multi-período é a forma correta e entra quando houver esse dado. Fixado aqui para não virar retrofit.

### 3. Estorno: lançamento de contrapartida, nunca apagar

Um estorno (comanda reaberta, refund de assinatura) **nunca apaga o lançamento original** — gera um **lançamento de contrapartida** (reversing entry) com `direction` oposta e valor positivo (partidas dobradas + trilha de auditoria). A **competência do estorno** segue o estado do período:

- **Período aberto** (mesmo mês do fato): estorno na **mesma competência** — o resultado líquido do período já sai correto.
- **Período fechado**: estorno na **competência da data do estorno** (período corrente), **jamais reabrindo o período fechado** (imutabilidade; análogo a _prior-period adjustment_). Um refund em julho de uma competência de maio deduz receita em **julho**.

> **Refinamento futuro (escolha, não erro).** Se estornos forem frequentes e estimáveis, a doutrina manda **provisionar** (allowance for returns) na competência da receita, entrando líquida de estornos esperados. V0 usa estorno por contrapartida na data do evento; provisão é posterior.

### 4. Fonte de verdade: o event stream imutável, não a projeção

O Razão deriva do **event stream** (`events`), filtrado por **competência** — não das projeções-snapshot. Consequências:

- A projeção Postgres continua existindo, mas como **cache de leitura reconstruível**, nunca como autoridade do Razão.
- A **competência é dado de primeira classe**: vive no payload do fato (`closedAt`/`paidAt`/período/`reopenedAt`), não em `created_at` (wall-clock do append) nem no `timestamp` do envelope (wall-clock de emissão). Materializada como coluna `events.occurred_at` (indexada) para a janela do Razão ser range-scan por competência.
- Isto **não é dual-write nem aggregate ES novo**: o Razão não emite evento; deriva do log de fatos que já existe (cross-aggregate). A fronteira ES/CRUD (ADR 0010) e o `PersistencePort` (ADR 0012) não se reabrem — ganha-se só uma **porta de leitura** do stream por org+janela. Ler o stream financeiro não vaza PII porque PII nunca vive no payload (ADR 0010 D2).

### 5. Eventos ganham os campos que o fato sempre teve

Para o stream ser a fonte fiel, três fatos econômicos hoje ausentes do payload são materializados (readaptação de evento, não evento de razão):

- **`order.closed` carrega o snapshot dos `items`** — a comanda fechada _é_ a venda; a receita reconhece-se por item (grão mais fino do fato). Consistente com `commission.created`, que já snapshota por item.
- **`order.reopened` carrega `reopenedAt`** (competência do estorno) **e `reversedClosedAt`** (competência da venda estornada).
- **`charge.refunded` passa a existir** como evento — hoje `status='refunded'` é estado alcançável sem evento produtor (viola "sem mudança de estado sem evento", ADR 0010). O evento é modelado agora; o E2E do fluxo de refund espera a parceria de pagamento (kill-switch de gateway).
- Invariante `paid ⇒ paidAt` (CHECK no banco + refinamento no schema do domínio) — uma charge paga sem data de pagamento é irrepresentável.

## Consequences

- **Positivas:** o Razão é contabilmente correto por construção (competência, contrapartida, imutabilidade); os 7 bugs do review morrem na raiz (4 só pela troca de fonte); a auditabilidade vem de graça (a fonte já é o log append-only); o modelo comporta lançamento retroativo e refund sem retrofit.
- **Custo:** readaptação de 3 eventos + bump de `schemaVersion` (order, charge) + o **primeiro upcaster do codebase** + coluna `events.occurred_at` + índice + backfill + a porta `readOrgEventStream`. Assumido conscientemente (o dono priorizou correção sobre esforço).
- **Dependência de produto:** a regra de pro-rata da assinatura (§2) e a política de estorno-de-período (§3) são decisões de produto materializadas aqui; refinamentos (provisão de estornos, deferred revenue explícito) ficam para quando houver dado real.
- **Reaproveitamento:** o modelo dimensional já implementado (vocabulário 3D `LedgerEntry` + `classify` pura + corte MC) permanece; só o adapter troca de fonte.

## Notas de implementação (MR de fundação — Ondas 0/1/2)

Addenda de execução; não alteram as decisões acima.

- **RLS na `events` adiada (issue #1384).** §4 fala em "porta de leitura do stream". Ao implementá-la descobriu-se empiricamente (sonda `events-rls-replay-probe`) que habilitar `FORCE ROW LEVEL SECURITY` na `events` **quebraria o replay**: o caminho de replay (`getEvents`) lê **sem** setar o GUC `app.current_org`, então sob a policy `org_id = current_setting(...)` leria **zero linhas**. Enquanto o replay não migrar para `readUnderRls`, tanto o replay quanto o `readOrgEventStream` scopam por `WHERE org_id = $1` no pool cru (mesma postura que o replay já usava). A RLS na `events` fica adiada para #1384 (migrar o read path primeiro). Isolamento continua enforçado pelo filtro explícito de org, como o replay sempre dependeu.
- **Pro-rata V0 degenerado (§2) — confirmado na implementação.** `classifyChargeRevenue` emite **1 lançamento** na competência `periodStartAt`; o ciclo mensal alinhado torna competência ≈ 1 mês. O pro-rata multi-período (ciclo anual/atrasado) entra sem remodelar — a competência já é derivada do período, não do pagamento.
- **Auto-suficiência do fato exigiu 2 campos além dos listados em §5.** Como o Razão lê o stream por org+janela (nunca replay por-aggregate), cada fato precisa ser derivável do **seu evento só**: (a) `order.closed` snapshota também `unitId` (além de `items`) — a receita/CSP da comanda são escopadas por unidade; (b) `charge.succeeded` snapshota `amountCents` + `unitId` no changeset (além de `periodStartAt`) — a receita de assinatura deriva do evento de reconhecimento, sem buscar o `charge.created`. Quando o produtor real de `charge.refunded` existir, seu changeset deve carregar `amountCents` + `unitId` + `refundedAt` (simetria).
- **Competência da comissão = `commission.created.data.createdAt` (= `closedAt`).** A comissão herda a competência da venda; `competenceOf` a mapeia para o `createdAt` do snapshot. O backfill da migration é **load-bearing** aqui: eventos `commission.created` **existem em produção** (um por fechamento de comanda), então sem o backfill o CSP legado ficaria fora da janela de competência do Razão.

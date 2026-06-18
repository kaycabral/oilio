# ADR 0010 — Event Sourcing seletivo (núcleo) + CRUD com snapshot-on-use

- **Status**: accepted
- **Date**: 2026-06-01
- **Deciders**: kaycabral
- **Brief**: [`0025-es-conformidade-total`](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0025-es-conformidade-total)
- **Amends**: [0008-event-sourcing-ddd-effect](0008-event-sourcing-ddd-effect.md) — restringe o escopo do Pilar 1 (ES) de "todo aggregate" para o núcleo financeiro/operacional. DDD tático (Pilar 2) e Effect-TS (Pilar 3) seguem valendo para todos.
- **Related ADRs**: [0004-multi-org-model](0004-multi-org-model.md), [0009-timezone-two-clocks](0009-timezone-two-clocks.md)
- **Glossário**: [Glossário](https://gitlab.com/cbrl/cbrl/-/wikis/Glossário) · taxonomia de sinais em [Linguagem Ubíqua § Sinais](https://gitlab.com/cbrl/cbrl/-/wikis/Linguagem-Ubíqua)

## Context

A ADR 0008 cravou Event Sourcing como invariante **uniforme** ("todo aggregate é event-sourced"). Na prática isso é mais agressivo do que a boa engenharia recomenda: Greg Young (que cunhou ES/CQRS) alerta que ES é overusado e caro de reverter; Fowler documenta a complexidade. ES rende quando a **verdade temporal é requisito de negócio** — não como arquitetura cobertor.

Uma auditoria multi-agente (1 agente por aggregate + crítico cross-aggregate, 2026-06-01) confirmou: dos 19 aggregates, **a maioria é definição/config/identidade** — estado atual é o que importa, edição é ocasional. Forçar ES neles gera dois custos concretos:

1. **Fricção LGPD.** Eventos são imutáveis; o direito à eliminação (LGPD Art. 18) não tem caminho quando PII vive no payload. Hoje `org`, `unit`, `professional`, `notification`, `invite` gravam PII (CPF/CNPJ, whatsapp, email, nome) em streams imutáveis. O `customer` já faz **certo** (PII fora do evento, materializada de `users/` na leitura) — mas é o único.
2. **Over-engineering.** Cada operação ES custa evento + reducer + schema + teste de replay + upcaster. Para uma definição (catálogo, plano, unidade), isso é peso sem retorno — a integridade já vem de outro mecanismo (snapshot-on-use), não do event log.

## Decision

### D1 — Event Sourcing é seletivo: só o núcleo

ES vale **apenas** para aggregates cuja verdade é temporal/contratual/financeira, com ciclo de vida real:

| **Event-sourced (núcleo)**                                                           | **CRUD + snapshot-on-use (definição/config/identidade)**                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `order` · `commission` · `charge` · `cash-movement` · `subscription` · `appointment` | `catalog-item` · `category` · `product` · `service` · `subscription-plan` · `professional` · `unit` · `org` · `customer` · `membership` · `notification` · `agenda-block` · `invite` |

Critério (≥1 forte → ES): (1) "o que valia em T" é pergunta de negócio (dinheiro, contrato, fiscal); (2) máquina de estados rica e reconstruível; (3) append-only intrínseco. Senão → CRUD.

`cash-movement` é ES por ser **ledger append-only** (reversão = novo movimento). `appointment` e `subscription` são ES por ciclo de vida + dinheiro/contrato. `product`/`service`/`catalog-item` convergem no catálogo unificado ([0023]) — tratados como um.

### D2 — Contrato canônico: **PII nunca no payload de evento**

O padrão do `customer` vira lei para todo aggregate ES que toque PII: o evento referencia um **id**; a PII vive num doc mutável e **apagável** (ex.: `users/{uid}`), materializada na leitura. Garante o direito à eliminação sem quebrar o stream. Onde um aggregate ES precisa de PII num registro transacional, snapshota o **mínimo necessário** e referencia o id para o resto.

### D3 — Contrato canônico: **snapshot-on-use** protege CRUD

A integridade de uma definição CRUD não vem de ES — vem de **capturar os termos no momento do uso** no registro transacional. Já implementado e mantido: `SubscriptionPlanSnapshot` (assinatura congela o plano), `OrderItem.unitPriceCents`/`commission` (comanda congela o item), `Appointment.servicePriceCentsSnapshot`/`commissionSnapshot`. **Editar a definição nunca retroage** no que já foi firmado.

### D4 — Evolução de definição é **analytics**, não ES

Histórico de "como preço/plano mudou no tempo" (coorte, retenção, pricing) é **analytics de produto** (`track()` → CDP), não domain event. Mudança de preço/termos de uma definição emite um evento de analytics (`*_price_changed`, de/para + data), na camada certa — queryable e apagável. Ver [Linguagem Ubíqua § Sinais].

### D5 — Decisões de produto associadas (2026-06-01)

- **Troca de plano de assinante ativo:** editar o plano vale **só para novas assinaturas** (snapshot congela os ativos). Trocar o plano de um assinante ativo é ação explícita com consentimento → evento de domínio `subscription.plan_changed`, nunca efeito colateral de editar o plano. **Requisito de UX:** a tela de edição deve deixar explícito _"vale só para novas assinaturas; assinantes atuais mantêm o plano contratado"_.
- **Delete de master data (padrão único):** referenciado → não deleta, **arquiva** (`archivedAt`, some da UI, registros antigos intactos); não-referenciado → hard-delete liberado (limpar erro). Vale para `subscription-plan`, `catalog-item`/`service`/`product`, `unit`, `category`.
- **Profissional rejeitado (`approved`→`rejected`):** registros passados ficam **válidos e intocados**; a rejeição só bloqueia **novos** agendamentos, com evento registrando a transição.
- **Invite com email errado:** PII (email) **fora do evento**, num doc corrigível/apagável (aplica D2) — corrige o typo e atende LGPD.

## Consequences

**Simplifica:**

- `customer`/`membership` viram CRUD → a conversão do `user-merge` para saga ES (#1033) deixa de ser necessária; o merge volta a ser operação de manutenção CRUD direta (sem eventos de baixa intenção). Reavaliar #1033 sob esta ADR.

**Trabalho de conformidade gerado (issues a abrir):**

- **PII legado em eventos** (`org`/`unit`/`professional`/`notification`/`invite`): aplicar D2; os streams já emitidos são passivo a expurgar (decidir crypto-shred vs reescrita na migração).
- **snapshot-on-use GAPs**: `org.cancellationPolicy`/`timezone`/`slotMinutes` lidos ao vivo retroagem em histórico — snapshotar no `appointment` ou aceitar conscientemente.
- **`appointment` snapshot drift vs `order`** (risco financeiro): `appointment.updated` não pode alterar snapshot já consumido por um `order`.
- **Delete sem guarda** (`subscription-plan`, `unit`): aplicar D5 (arquivar/bloquear).

**Docs a sincronizar (sem drift):** brief `0025`, ADR `0008` (nota de emenda), `Linguagem-Ubíqua § Arquitetura base`, `CLAUDE.md` raiz + `apps/oilio/web/CLAUDE.md` (a frase "event-sourced puro" passa a "ES seletivo no núcleo").

## Alternatives considered

- **Manter ES uniforme (0008 como está).** Rejeitado: fricção LGPD real (PII imutável em config/identidade) + custo de ES em 13 aggregates que não rendem verdade temporal.
- **CRUD total (abandonar ES).** Rejeitado: o núcleo financeiro/operacional (comanda, comissão, caixa, cobrança, assinatura, agendamento) tem verdade temporal/contratual genuína — auditoria e reconstrução são requisito, não luxo.
- **Versionar definições (plano/item imutáveis com histórico).** Rejeitado como over-engineering: a verdade transacional já está no snapshot; a inteligência de evolução é melhor servida por analytics (D4); "aposentar" é coberto por arquivar (D5).

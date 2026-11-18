# ADR 0007 — PaymentGateway interface (cláusulas + contrato)

- **Status**: accepted
- **Date**: 2026-05-21
- **Deciders**: kaycabral
- **Supersedes**: [`08-Features-0006-pagar-me-umbrella`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0006-pagar-me-umbrella) (deprecated)

## Context

Múltiplos briefs operacionais consomem o gateway de pagamento (Pagar.me hoje):

- [`08-Features-0003`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0003-cobranca-recorrente) — cobrança recorrente automática
- [`08-Features-0004`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0004-split-pagamento) — split de pagamento
- [`08-Features-0005`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0005-conciliacao-caixa) — conciliação caixa

Antes (até 2026-05-21) essas regras compartilhadas viviam num "umbrella governing brief" (0006) + issue parent (#781). O conceito de umbrella se mostrou ANTI-PATTERN — caused 5 sub-issues drift, DoD não-aplicável, duplicação de metadata com briefs filhos. Princípio canônico [`#15` do harness](https://github.com/cbrl-dev/harness/blob/main/docs/product-planning-principles.md#15) reformula: cláusulas cross-brief vivem em ADR; cluster tag pra discoverability.

Este ADR consolida as cláusulas + contrato `PaymentGateway` num único local técnico de decisão. Briefs filhos referenciam.

## Decision

### Cláusulas canônicas

#### C1 — Troca de gateway sem lock-in (não-negociável)

Origem: a escolha do gateway depende de condições comerciais que podem mudar; se mudarem, a troca de gateway acontece sem refatoração estrutural.

**Implicação técnica:**

- Toda chamada Pagar.me passa pela interface `PaymentGateway` deste ADR.
- ESLint rule local `no-direct-pagarme-import` em arquivos fora de `apps/<app>/src/lib/gateway/pagarme/`.
- Schemas internos (`Subscription`, `Commission`, `CashMovement`, `Subaccount`) **não** carregam tipos Pagar.me — campos opacos (`gatewaySubscriptionId`, `gatewayTransferId`) que apontam pro gateway atual.

#### C2 — Manual é cidadão de primeira classe

Origem: **Modelo de Receita** ([`02-Estrategia-Modelo-Receita`](https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Receita) § 3.2). Plano comercial × tecnologia de cobrança são eixos ortogonais: `gateway_auto` / `manual` / `onsite` igualmente válidos. Alvorada paga Plano via Pix manual mensal — comum no mercado regional brasileiro, **não exceção**.

**Implicação técnica:**

- `Subscription.chargeTechnology: 'gateway_auto' | 'manual' | 'onsite'` é cidadão; nenhum default elimina manual.
- Profissional sem CNPJ aprovado: split → `ManualPayoutQueue`.
- UI nunca esconde modo manual; reverter de `gateway_auto` pra manual é fluxo suportado.

#### C3 — Não somos compliance hub

Origem: princípio operacional. KYC, antifraude, regulação fiscal vivem **no gateway**. Coletamos o mínimo, enviamos ao gateway, processamos retorno.

**Implicação técnica:**

- KYC profissional: schema (`taxIdentity` requerido) + envia pro Pagar.me + processa retorno.
- Sem cálculo de imposto local (V1).
- Reconciliação só com payouts do gateway (não com extrato bancário final).

## Interface `PaymentGateway`

Contrato canônico que cada implementação (Pagar.me hoje; outro amanhã) satisfaz.

```ts
interface PaymentGateway {
  // Customer + subscription lifecycle (brief 0003)
  createCustomer(input: CustomerInput): Promise<GatewayCustomerId>
  createSubscription(input: SubscriptionInput): Promise<GatewaySubscriptionId>
  cancelSubscription(id: GatewaySubscriptionId): Promise<void>

  // Subaccount + split (brief 0004)
  createSubaccount(input: SubaccountInput): Promise<GatewaySubaccountId>
  getSubaccountStatus(id: GatewaySubaccountId): Promise<SubaccountStatus>
  executeSplit(input: SplitInput): Promise<GatewayTransferId[]>

  // Payout + reconciliation (brief 0005)
  listPayouts(period: DateRange): Promise<Payout[]>
  getPayoutTransfers(payoutId: string): Promise<Transfer[]>

  // Webhooks (transversal)
  verifyWebhookSignature(payload: string, signature: string): boolean
  parseWebhookEvent(payload: string): GatewayEvent
}
```

Tipos `Gateway*Id` são opacos (`string` branded) — domínio não introspecta formato.

## Discoverability

Briefs do cluster Pagar.me têm `cluster: pagarme` no frontmatter. Filtrável via `grep -l "cluster: pagarme" /tmp/cbrl-wiki/08-Features-*.md`.

## Consequences

- Cláusulas C1..C6 deixam de viver em brief governing; viram tech ADR direto referenciado por briefs operacionais.
- Brief 0006 fica `status: deprecated` apontando pra este ADR.
- Issue #781 (umbrella parent) fecha com explanation + crossref.
- Subsequente: cluster tag `cluster: pagarme` em 0003/0004/0005 frontmatter pra discoverability.

## References

- Brief deprecated: [`08-Features-0006-pagar-me-umbrella`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0006-pagar-me-umbrella)
- Princípio canônico harness: [`#15` Cláusulas cross-brief em ADR](https://github.com/cbrl-dev/harness/blob/main/docs/product-planning-principles.md#15) (a criar)
- Modelo de Receita: [`02-Estrategia-Modelo-Receita`](https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Receita)

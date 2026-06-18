# ADR 0008 — Event Sourcing + DDD + Effect-TS

- **Status**: accepted (amended)
- **Date**: 2026-05-27
- **Deciders**: kaycabral
- **Brief**: [`0020-event-sourcing-ddd-effect`](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0020-event-sourcing-ddd-effect)
- **Parent issue**: [#979](https://gitlab.com/cbrl/cbrl/-/issues/979)
- **Supersedes**: nenhum (greenfield architecture)
- **Amended by**: [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) — o Pilar 1 (ES) deixa de ser uniforme ("todo aggregate") e passa a valer **só no núcleo financeiro/operacional**; o resto é CRUD + snapshot-on-use. Pilares 2 (DDD) e 3 (Effect-TS) seguem para todos.
- **Related ADRs**: [0004-multi-org-model](0004-multi-org-model.md), [0007-payment-gateway-interface](0007-payment-gateway-interface.md)

## Context

Scheduling V0 usa CRUD direto no Firestore — server actions leem/escrevem docs sem rastreabilidade de mutações. Domínio cresceu em complexidade (Subscription com 6 status, scope rules, billing cycles, charge technologies, commission splits) e já exibe patterns proto-ES emergentes:

- **Snapshots imutáveis**: `SubscriptionPlanSnapshot`, `OrderItem.commission`, `Appointment.servicePriceCentsSnapshot`
- **Discriminated unions**: `AgendaBlock` variants
- **Pure functions**: `computeOrderTotals`, `canCustomerCancelAppointment`, billing/availability utils
- **AuditLog**: union type com 40+ ações — proto-domain events sem payload tipado

Esses patterns surgiram organicamente. Esta ADR formaliza e unifica sob 3 pilares.

## Decision

### Pilar 1 — Event Sourcing

Toda mutação de domínio produz um **evento imutável** persistido numa subcollection `events/` do aggregate doc no Firestore. Uma **projeção** (o doc principal) é atualizada atomicamente na mesma transaction.

```
/orgs/{tid}/subscriptions/{sid}              ← projeção (estado atual)
/orgs/{tid}/subscriptions/{sid}/events/{eid} ← evento imutável
```

- `appendEvent<A>(ref, event)` valida via `@effect/schema`, atribui `version` sequencial, appenda evento, aplica reducer, atualiza projeção — 1 Firestore transaction.
- `replayAggregate(ref)` reconstrói estado a partir dos eventos — debugging + consistency check.
- Schema versioning via upcasters desde o dia 1.

### Pilar 2 — DDD tático

Cada aggregate tem bounded context com estrutura canônica:

```
packages/oilio/shared/src/domain/
  subscription/  → events.ts, reducer.ts, errors.ts, types.ts, schemas.ts
  order/         → ...
  appointment/   → ...
  customer/      → ...
  professional/  → ...
  unit/          → ...
  org/        → ...
```

- **Reducers puros**: `applyEvent(state, event): state` — testável, sem side effects.
- **Value Objects**: `Money`, `DateRange`, `BillingCycle`, `OrgId` — tipos opacos com validação, não primitivos raw.
- **Domain Events como union types**: `SubscriptionEvent = subscription.created | subscription.activated | ...`
- **Coordenação cross-aggregate**: via domain event reaction, não chamada direta entre aggregates.

### Pilar 3 — Effect-TS

- **Typed errors**: `Effect.fail(new AppointmentConflictError(...))` — sem `throw`, sem `try/catch` na camada de domínio.
- **Dependency injection via Layers**: `DbLayer`, `GatewayLayer`, `LoggerLayer` — testes substituem por test layers sem alterar código de produção.
- **Schema validation**: `@effect/schema` valida eventos e inputs — runtime safety.
- **Composability**: server actions compõem operations via Effect pipe.

### Server actions reescritas

Cada server action: (a) valida input via Effect schema, (b) carrega aggregate do Firestore, (c) executa domain logic pura, (d) persiste via `appendEvent`, (e) retorna resultado tipado ou erro tipado.

### AuditLog substituído

O event store É o audit log. `AuditAction` union type com 40+ ações migra pra domain events com payload tipado e schema validado. Subcollection `events/` dentro do org (consistente com ADR 0004 path-scoping).

### Firestore Security Rules

Subcollections `events/` são **server-only** — client write bloqueado via rules. Eventos só são escritos por server actions via Admin SDK.

## Interaction with existing ADRs

### ADR 0004 (multi-org path-scoped)

Event subcollections vivem **dentro** do path do org: `/orgs/{tid}/<aggregate>/{id}/events/{eid}`. Isolamento preservado. Proibição de `collectionGroup` sobre dados operacionais se estende a subcollections `events/`.

### ADR 0007 (PaymentGateway interface)

Interface `PaymentGateway` ganha tipos Effect: `createCustomer(input): Effect<GatewayCustomerId, GatewayError, GatewayLayer>`. Kill switch do Effect (§ abaixo) reverte pra `Promise<Result<T, E>>` — contrato semântico sobrevive.

## Kill switch

Se Effect-TS introduzir complexidade ingerenciável (bundle > +50%, build time triplica, DX degrada), reverter pra TS nativo com mesmos patterns: discriminated unions + `Result<T, E>` type caseiro + pure functions. A arquitetura (ES + DDD + eventos tipados) sobrevive sem Effect — a lib é acelerador, não fundação.

## Alternatives considered

### 1. Manter CRUD + adicionar audit log manual (rejeitada)

Já é o estado atual. Audit log tem 40+ ações sem payload tipado, sem schema validation, sem replay capability. Complexidade do domínio (6 status de subscription, scope rules, charge technologies) torna CRUD+audit insuficiente pra rastreabilidade.

### 2. Event Sourcing com banco dedicado — EventStoreDB ou PostgreSQL (rejeitada para V0)

Overhead de infra inviável pra V0 sem tráfego real. Firestore já é o banco; adicionar outro seria duplicação. **Condição de reabertura**: se volume escalar a ponto de reads de replay ficarem caros (milhares de orgs × centenas de eventos/aggregate/mês). Eventos já são tipos — migrar storage = trocar `appendEvent` implementation, não reescrever domínio.

### 3. DDD sem Event Sourcing (rejeitada)

DDD tático organiza código, mas sem ES perde rastreabilidade completa, replay capability, e a fundação pra agentes AI futuros consumirem event streams como contexto.

### 4. fp-ts em vez de Effect-TS (rejeitada)

fp-ts é predecessor, menor ecossistema, sem schema validation nativo, sem DI nativo. Effect-TS unifica: typed errors + schema + DI + concurrency + tracing. Trade-off: bundle maior, learning curve. Mitigação: tree-shaking + Effect só server-side.

## Consequences

### Positive

- Auditoria automática — event store substitui audit log manual.
- Rastreabilidade completa — toda mutação produz evento tipado com version, timestamp, actorId.
- Replay — debugging e consistency validation sem queries ad-hoc.
- Composability — Effect pipe + typed errors eliminam callback hell e try/catch chains.
- AI-native ready — event streams são contexto completo pra agentes futuros (brief futuro).
- Testabilidade — reducers puros + Effect test layers.

### Negative / accepted

- Learning curve — Effect-TS é paradigma diferente do TS mainstream. Mitigação: owner + AI como time.
- Bundle size — `effect` + `@effect/schema` não são pequenos. Mitigação: tree-shaking + server-only. Guardrail: bundle não regredir além de +20%.
- Event schema versioning — upcasters adicionam complexidade incremental. Mitigação: infra de upcasting desde o dia 1, volume baixo.
- Big bang migration — todas entidades migram de uma vez. Aceito: sem dados de produção, sem risco de rollback parcial.

## Guardrails

| Metric               | Baseline       | Threshold                    |
| -------------------- | -------------- | ---------------------------- |
| E2E test pass rate   | 100%           | must not regress             |
| Build time (cold)    | ~30s           | must not regress beyond +50% |
| Bundle size (client) | measure before | must not regress beyond +20% |

## References

- Brief: [`0020-event-sourcing-ddd-effect`](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0020-event-sourcing-ddd-effect)
- Parent issue: [#979](https://gitlab.com/cbrl/cbrl/-/issues/979)
- ADR 0004: [multi-org model](0004-multi-org-model.md)
- ADR 0007: [payment gateway interface](0007-payment-gateway-interface.md)
- Decisões Técnicas Fundantes: [Wiki](https://gitlab.com/cbrl/cbrl/-/wikis/Roadmap/Decisões-Técnicas-Fundantes)

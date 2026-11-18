# apps/web — Frontend (@oilio/web)

## Escopo

O app é **um único workspace** (`@oilio/web`). Código do app (domínio, tipos, helpers) vive em `src/` e é consumido via o alias `@/` (ex.: `@/domain`). `packages/*` guarda só infraestrutura app-specific (`@oilio/product` base de produtos) — não promova código de domínio pra lá. Infra compartilhada vem do npm (`@cbrl/pg` pool Postgres, `@cbrl/design` design system, `@cbrl/env`, `@cbrl/testing`, `@cbrl/eslint-config`, `@cbrl/tsconfig`).

## Aliases

`@/...` resolve pra `apps/web/src/` (intra-app). Ex.: `import { User } from '@/domain'`. Entre workspaces: `@oilio/<pkg>` (ex.: `@oilio/product`); pacotes compartilhados do npm: `@cbrl/<pkg>` (ex.: `@cbrl/design`, `@cbrl/testing`).

## Arquitetura — feature slices

Código de feature vive em `src/features/<slice>/{core,adapters,ui}` (dependência só desce: `ui→adapters→core`; rota em `app/` é casca-fina). core é puro (sem React/I/O), unit-testável; adapters fazem I/O; ui é componente humilde. Convenção canônica + vocabulário de sufixo + enforcement em [`PATTERNS.md` § Feature slices](../../PATTERNS.md#feature-slices-functional-core--imperative-shell). Parede de lint: `@cbrl/eslint-config/configs/layering.mjs` (violar = pipeline vermelho). Migração em burndown — `agenda` é a fatia de referência.

## Auth

Supabase Auth, só Google (OAuth PKCE via `@supabase/ssr`; ADR [`0020`](../../docs/decisions/0020-supabase-vercel.md)). Código em `@/shared/auth/`: `getSessionUser` (`session.ts`) confia só em `getClaims()` (JWT verificado) e devolve um `SessionUser` (`session-user.ts`: `uid`, `authUserId`, `email`, `displayName`, `picture`, `emailVerified`). `uid` é a identidade do app (imutável no event store): conta nova usa o id do Supabase; conta migrada do Firebase carrega o uid legado em `app_metadata.oilio_uid` (só service role escreve). Callback OAuth em `src/app/auth/callback/route.ts`; refresh de sessão em `src/proxy.ts`; gate de config em `isAuthConfigured` (`@/shared/auth/config`). Não existe `/api/session`. `/api/e2e-signin` (email/senha) é só de teste: 404 sem `ENABLE_TEST_AUTH=true`, que só o Playwright seta. Acesso a dados: event store + projeções Postgres em `@/shared/db` — o pool vem de `@cbrl/pg` (npm), sem package de dados próprio (ver § Escopo: workspace único, código compartilhado vive em `src/` via `@/`).

## Multi-org — invariantes

Toda rota autenticada vive sob `(app)/` e o layout resolve o org via `getActiveOrgContext(uid)`, redirecionando pra `/onboarding` se o usuário ainda não tem org. **Não há gate global de onboarding** (brief 0008): o app é operável desde o signup; o setup acontece just-in-time pelos empty-states acionáveis (#987), e a completude só é exigida ao **publicar o self-booking** (`selfBookingPublished`, #988). O contexto é injetado client-side via `<OrgProvider>` — consuma com `useOrg()`.

**Invariantes não-negociáveis** (ver ADR [`docs/decisions/0004-multi-org-model.md`](../../docs/decisions/0004-multi-org-model.md) pra contexto e alternativas).

O **princípio** de isolamento é estável desde o V0; a **implementação** migrou de Firestore pra Postgres no cutover (#1202, ADRs [`0010`](../../docs/decisions/0010-event-sourcing-seletivo.md)/[`0012`](../../docs/decisions/0012-relational-event-store-persistence-port.md)). Os dois separados abaixo.

_Princípio (estável):_

- **Sem cross-org query.** Nenhum read/write de produto cruza orgs. Toda query é escopada à org do contexto ativo; code review pode rejeitar PR que vaze escopo como violação de ADR.
- **Server actions usam `requireOrgCtx`/`requireManagerCtx`/`requireOwnerCtx`** antes de qualquer write — a autorização da aplicação é camada própria, não se confia só no isolamento do banco.
- **Audit = event stream (ver § Event Sourcing).** Em ES, a auditoria é o próprio stream de domain events. `recordAudit`/`audit_logs` é mecanismo **legado pré-ES** — débito a converter em projeção; **não** adicionar `recordAudit` novo em feature nova.
- **Troca de org ativo**: hoje só via o `currentOrgId` do usuário (sem UI no V0).
- **Dashboard cross-org fica fora do V0.** Owner com 2 orgs alterna; não há agregado.

_Implementação (Postgres, pós-#1202):_

- **Isolamento por RLS.** O escopo por org é garantido pelo **banco** via Row-Level Security: cada tabela org-scoped tem policy sobre a coluna `org_id`, ativada por GUC (`set_config`) no `SecurityContext` da transação — ver `src/shared/db/pg/{guc,rls-read}.ts`. A role da app não tem `BYPASSRLS`, então a recusa cross-org vem do banco, provada por integration.
- **Org scoping**: dados específicos de org carregam a coluna `org_id` (FK `org_id → orgs.org_id`) na projeção tipada do aggregate. Nada de coleção/subcoleção — projeções relacionais em `src/shared/db/pg/schema/`.
- **Memberships / user doc**: `memberships` e `users` são tabelas org-neutras (não sob RLS por design — `users` é global, `memberships` resolve o vínculo); o `currentOrgId` do usuário escolhe a org ativa.

## Event Sourcing — seletivo (núcleo) + CRUD com snapshot-on-use

**ES é seletivo**, não uniforme. Decisão em [`docs/decisions/0010-event-sourcing-seletivo.md`](../../docs/decisions/0010-event-sourcing-seletivo.md) (emenda o [`0008`](../../docs/decisions/0008-event-sourcing-ddd-effect.md)); conceito canônico na Wiki [[Linguagem Ubíqua]] § "Arquitetura base" + [[Glossário]].

- **Núcleo event-sourced** (verdade temporal/contratual/financeira): `order` · `commission` · `charge` · `cash-movement` · `subscription` · `appointment`.
- **CRUD + snapshot-on-use** (definição/config/identidade): `catalog-item` · `category` · `product` · `service` · `subscription-plan` · `professional` · `unit` · `org` · `customer` · `membership` · `notification` · `agenda-block` · `invite`.

**Regras dos aggregates ES (núcleo):**

- **Domain event é a fonte de verdade.** Toda mudança de estado emite evento (via `appendEvent` / `appendEventToTx`) — append-only, imutável, na tabela `events` (`UNIQUE(aggregate_id, version)`).
- **Estado é projeção.** A projeção tipada deriva do evento (reducer projeta na **mesma transação ACID**). **Proibido dual-write**: nunca escrever a projeção direto + `appendEvent` em paralelo — o reducer é o único caminho.
- **Sem mudança de estado sem evento.** Se o evento não existe, modele-o primeiro (`@/domain/aggregates/<aggregate>`).
- **Replay/rehydration é o teste-prova.** O estado reconstrói só pelos eventos (`replayAggregate`); a projeção é descartável.
- **PII nunca no payload de evento.** Aggregate ES que toque PII referencia um **id**; a PII vive num sidecar apagável (`*_pii`), materializada na leitura. Garante o direito à eliminação (LGPD, ADR 0010 D2).

**Contratos canônicos (valem pros dois lados — ADR 0010):**

- **PII nunca no payload de evento.** Aggregate ES que toque PII referencia um **id**; a PII vive num doc apagável (padrão do `customer`: materializada de `users/` na leitura). Garante o direito à eliminação (LGPD).
- **snapshot-on-use protege o CRUD.** Definição CRUD consumida num registro transacional tem seus termos (preço, comissão, regras) **capturados no momento do uso** (`SubscriptionPlanSnapshot`, `OrderItem.unitPriceCents`, `Appointment.*Snapshot`). Editar a definição **nunca retroage**.
- **Evolução de definição é analytics, não ES** — mudança de preço/plano vira evento de `track()` (CDP), não domain event. Ver [[Linguagem Ubíqua]] § Sinais.

**Feature nova que toca um aggregate ES = event-first** (o `/feature` aplica ao DoD): 1. evento por mudança de estado · 2. reducer/projeção · 3. **teste de replay** · 4. auditoria via stream. Feature em aggregate CRUD: snapshot-on-use nos consumidores + PII fora de evento.

### Convenções que resolvem os forks recorrentes (decididas 2026-05-30)

Duas regras fixas pra conformidade de ES não re-levantar decisão a cada aggregate (pré-resolvidas pra `/implement` rodar autônomo):

- **Cascata cross-aggregate = saga ACID única** (Postgres é o backend único pós-cutover #1202; ADR [`0012`](../../docs/decisions/0012-relational-event-store-persistence-port.md) §D3, brief [0061](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0061-migracao-postgres-nucleo-financeiro-es)). Quando uma action muda **mais de um aggregate** (ex.: fechar comanda → comissão + agenda + assinatura + caixa; onboarding → org + membership; aceite → invite + membership), a cascata roda como **transação ACID única** via `commitSaga`/`appendEventToTx`/`appendDeleteToTx`/`commitGuardedThenAppend` (em `@/shared/effect-bridge` + `@/domain/effect`) — todos os eventos + projeções na mesma tx; falha de qualquer passo (CHECK/FK/RLS/schema) faz `ROLLBACK` total. **A atomicidade do banco substitui a compensação manual** — não escreva código de desfazer (`compensate*`/`emitUndoCompensation`): a regra antiga de compensação existia _porque_ o Firestore não dava tx cross-aggregate; o cutover removeu o Firestore e a compensação junto. Writes **não-aggregate** (doc global `users`, PII sidecars `*_pii`) **não** entram na tx do event store — ficam pós-commit (idempotentes). Padrão de referência: `orders/adapters/order-saga.ts` (`emitCloseOrderSaga`). O único passo que nunca será ACID puro é I/O externo não-transacionável (gateway de pagamento, deferred) — exigirá outbox. O **lado-cliente** do defect de DB (classificar o SQLSTATE numa mensagem genérica segura, sem vazar constraint/tag) segue o **contrato de erro canônico** (ADR [`0015`](../../docs/decisions/0015-canonical-error-contract.md)): `catchSagaDefect` consome `classifyError` (`@/shared/errors/classify`) — nunca reintroduza mensagem por-SQLSTATE ad-hoc.
- **Aggregate atrás de kill-switch de gateway = converge domínio agora, E2E espera.** Pra aggregates gated por `isPaymentsGatewayEnabled` (charge, split/subconta — parceria em stand-by): modelar eventos + reducer + **teste de replay** + unit normalmente; o **E2E desses fluxos específicos espera a parceria** ligar o gateway. Não bloqueia as outras fatias.
- **Efeito de fechamento de comanda = fonte pura única + invariante travada (#B4).** Cada efeito da cascata de fechamento (estoque, cota do plano, comissão, receita) é decidido por **uma** função pura no core (`@/domain/utils/order`), derivada **só dos itens** da comanda — nunca do caminho de entrada (balcão vs agendamento) nem duplicada por lado (close vs undo). Regras que são independentes ficam independentes: estoque baixa para **todo produto** (`stockDecrementTargets`, `kind==='product'`, imune a `coverage`); a cota só debita item coberto (`coveredItemQuantity`); a receita só conta `sale` (`computeOrderTotals`). Mudar uma regra = editar **um lugar**, e o close e o undo mudam juntos porque **chamam a mesma função** sobre a comanda imutável — o que baixa é o que devolve, por construção. Isso é travado por `order-closure-invariants.test.ts` (simetria close/undo + consistência cross-entry + coverage-não-afeta-estoque): se um caminho novo divergir ou a regra vazar entre efeitos, o CI fica vermelho. **Não** reintroduza a regra de um efeito acoplada à de outro (o furo B4 foi estoque acoplado a `coverage`), nem escreva uma segunda função pro undo.

**Ordem de conformidade quando o aggregate é tocado por uma cascata:** conforme os aggregates-folha **antes** do que integra. Ex.: comissão/caixa/agenda antes do **fechamento da comanda** (que depende deles). E **não conformar aggregate que uma mudança de produto vai deletar** — sequencie a mudança de produto primeiro (ex.: caixa só depois de [[0015]] tirar abrir/fechar).

## RBAC

Papéis: `owner`, `manager`, `professional`, `receptionist`.

- `canManageOrg(role)` / `canInviteMembers(role)` em `@/domain/types/enums`.
- `assertRole(membership, ...allowed)` / `assertCanManage(membership)` em `@/shared/org/membership.ts` lançam `AuthzError` quando role insuficiente.

## Agenda — timezone

**Storage sempre UTC, display sempre em org timezone.** Helpers canônicos em `@/domain/utils/timezone`. **Nunca use `getUTCHours()`/`getHours()` direto em código de agenda/comanda** — sempre passe pela conversão.

Detalhes (helpers, invariants, limitações) em [`docs/timezone.md`](../../docs/timezone.md).

## Invite flow

Canal normalizado para **WhatsApp** (brief 0084) — o convite de membro concede papel (privilégio), então o **token assinado permanece** a trava (ao contrário do convite de cliente, público não-assinado).

1. Owner/manager cria invite via `/(app)/team` → informa só o **WhatsApp**; a server action gera token random e persiste o invite (hash sha256 + role + `expiresAt = now + 48h`) escopado por `org_id`; o **WhatsApp** (PII) vai no sidecar apagável `invites_pii`, fora do payload de evento (ADR 0010 D2). Entrega via `wa.me` (reusa `@/features/team/core/member-invite`).
2. Link: `/invites/{orgId}/{inviteId}?token={raw}`.
3. Aceitar valida hash + expiry (+ `emailVerified` da conta Google, higiene) e cria Membership server-side. **Sem match por email/telefone** — identidade é **first-accept-wins**: o primeiro Google que aceita com token válido fica amarrado (`acceptedByUid` write-once, 1-uso), garantido pela CHECK `invites_acceptance_consistency`. O WhatsApp é canal de entrega, não chave de aceite.
4. Telemetria de funil PII-zero (`member_invite_issued`/`_opened`/`_accepted`, tabela `member_funnel_events`).

## Forms + Server Actions

Toda mutation server-side **deve** ser disparada por `<form action={serverAction}>` com `<button type="submit">`. Pattern canônico + anti-patterns banidos em [`PATTERNS.md` § Forms + Server Actions](../../PATTERNS.md#forms--server-actions-progressive-enhancement). Refs: incidente #763, refactor #936.

## Testes

Convenções universais em [`TESTING.md`](../../TESTING.md). Especificidades do scheduling (Playwright layout, stack Supabase local, isolation, integração Postgres) em [`docs/e2e-conventions.md`](../../docs/e2e-conventions.md). Como rodar (e o que cada script sobe sozinho) em [`README.md` raiz § Scripts](../../README.md#scripts).

**Invariantes de dados são provadas contra Postgres real, não mockadas** — testes de RLS/constraint rodam integration (`*.events.pg.integration.test.ts`) contra um Postgres efêmero (`docker/postgres.compose.yaml`, local e no CI), nunca contra um banco mockado. O isolamento cross-org e os CHECK/FK/UNIQUE são recusados pelo **banco**, e o teste prova isso de verdade.

# apps/oilio/web — Frontend (@oilio/web)

## Escopo

Oilio é **um único workspace** (`@oilio/web`) — não existe `@oilio/shared`/`@oilio/lib`/`@oilio/db` nem `packages/oilio/*`. Modifique APENAS arquivos dentro de `apps/oilio/web/`. Código compartilhado do app (domínio, tipos, helpers) vive em `src/` e é consumido via o alias `@/` (ex.: `@/domain`). Só promova pra `packages/` (`@cbrl/*`) quando **2+ produtos** precisarem.

## Aliases

`@/...` resolve pra `apps/oilio/web/src/` (intra-app). Ex.: `import { User } from '@/domain'`. Cross-product compartilhado: `@cbrl/<pkg>` (ex.: `@cbrl/design`, `@cbrl/testing`).

## Arquitetura — feature slices

Código de feature vive em `src/features/<slice>/{core,adapters,ui}` (dependência só desce: `ui→adapters→core`; rota em `app/` é casca-fina). core é puro (sem React/I/O), unit-testável; adapters fazem I/O; ui é componente humilde. Convenção canônica + vocabulário de sufixo + enforcement em [`PATTERNS.md` § Feature slices](../../../PATTERNS.md#feature-slices-functional-core--imperative-shell). Parede de lint: `@cbrl/eslint-base/configs/layering.mjs` (violar = pipeline vermelho). Migração em burndown — `agenda` é a fatia de referência.

## Auth

Firebase Auth + session cookie. Package `db` deste projeto: `@oilio/db`.

## Multi-org — invariantes

Toda rota autenticada vive sob `(app)/` e o layout resolve o org via `getActiveOrgContext(uid)`, redirecionando pra `/onboarding` se o usuário ainda não tem org. **Não há gate global de onboarding** (brief 0008): o app é operável desde o signup; o setup acontece just-in-time pelos empty-states acionáveis (#987), e a completude só é exigida ao **publicar o self-booking** (`selfBookingPublished`, #988). O contexto é injetado client-side via `<OrgProvider>` — consuma com `useOrg()`.

**Invariantes não-negociáveis** (ver ADR [`docs/decisions/0004-multi-org-model.md`](../docs/decisions/0004-multi-org-model.md) pra contexto e alternativas):

- **Sem cross-org query.** Nunca `collectionGroup('<dado operacional>')` no código de produto. Toda query parte de `db.collection('orgs').doc(ctx.orgId)`. Code review pode rejeitar PR que adicione `collectionGroup` operacional como violação de ADR.
- **Sem coleção operacional top-level.** Só `users` e `memberships` podem ser top-level. Qualquer dado novo (ex.: `expense_categories`) entra como `orgs/{orgId}/<nova_coleção>`.
- **Server actions usam `requireOrgCtx`/`requireManagerCtx`/`requireOwnerCtx`** antes de qualquer write — nunca confiar só nas Firestore Rules.
- **Org scoping**: dados específicos de org em `orgs/{orgId}/{collection}/{id}` (units, professionals, customers, invites, audit_logs).
- **Memberships**: top-level `memberships/{orgId}_{userId}`. Helper `membershipDocId()` em `@oilio/shared`.
- **User doc**: top-level `users/{uid}` com `currentOrgId` (escolha de org ativo).
- **Audit = event stream (ver § Event Sourcing).** Em ES, a auditoria é o próprio stream de domain events. `recordAudit`/`audit_logs` é mecanismo **legado pré-ES** — débito a converter em projeção; **não** adicionar `recordAudit` novo em feature nova.
- **Troca de org ativo**: hoje só via `users/{uid}.currentOrgId` (sem UI no V0).
- **Dashboard cross-org fica fora do V0.** Owner com 2 orgs alterna; não há agregado.

## Event Sourcing — seletivo (núcleo) + CRUD com snapshot-on-use

**ES é seletivo**, não uniforme. Decisão em [`docs/decisions/0010-event-sourcing-seletivo.md`](../docs/decisions/0010-event-sourcing-seletivo.md) (emenda o [`0008`](../docs/decisions/0008-event-sourcing-ddd-effect.md)); conceito canônico na Wiki [[Linguagem Ubíqua]] § "Arquitetura base" + [[Glossário]].

- **Núcleo event-sourced** (verdade temporal/contratual/financeira): `order` · `commission` · `charge` · `cash-movement` · `subscription` · `appointment`.
- **CRUD + snapshot-on-use** (definição/config/identidade): `catalog-item` · `category` · `product` · `service` · `subscription-plan` · `professional` · `unit` · `org` · `customer` · `membership` · `notification` · `agenda-block` · `invite`.

**Regras dos aggregates ES (núcleo):**

- **Domain event é a fonte de verdade.** Toda mudança de estado emite evento (via `emitEvent` / `appendEvent`) — append-only, imutável, na subcoleção `events/`.
- **Estado é projeção.** O doc Firestore deriva do evento (reducer projeta na mesma transação). **Proibido dual-write**: nunca `set/update/delete` direto + `emitEvent` em paralelo.
- **Sem mudança de estado sem evento.** Se o evento não existe, modele-o primeiro (`@oilio/shared/domain/<aggregate>`).
- **Replay/rehydration é o teste-prova.** O estado reconstrói só pelos eventos (`replayAggregate`); a projeção é descartável.

**Contratos canônicos (valem pros dois lados — ADR 0010):**

- **PII nunca no payload de evento.** Aggregate ES que toque PII referencia um **id**; a PII vive num doc apagável (padrão do `customer`: materializada de `users/` na leitura). Garante o direito à eliminação (LGPD).
- **snapshot-on-use protege o CRUD.** Definição CRUD consumida num registro transacional tem seus termos (preço, comissão, regras) **capturados no momento do uso** (`SubscriptionPlanSnapshot`, `OrderItem.unitPriceCents`, `Appointment.*Snapshot`). Editar a definição **nunca retroage**.
- **Evolução de definição é analytics, não ES** — mudança de preço/plano vira evento de `track()` (CDP), não domain event. Ver [[Linguagem Ubíqua]] § Sinais.

**Feature nova que toca um aggregate ES = event-first** (o `/feature` aplica ao DoD): 1. evento por mudança de estado · 2. reducer/projeção · 3. **teste de replay** · 4. auditoria via stream. Feature em aggregate CRUD: snapshot-on-use nos consumidores + PII fora de evento.

### Convenções que resolvem os forks recorrentes (decididas 2026-05-30)

Duas regras fixas pra conformidade de ES não re-levantar decisão a cada aggregate (pré-resolvidas pra `/implement` rodar autônomo):

- **Cascata cross-aggregate = saga, nunca transação única.** Quando uma action muda **mais de um aggregate** (ex.: fechar comanda → comissão + agenda + assinatura + caixa; onboarding → org + membership; aceite → invite + membership), cada aggregate emite **seu próprio evento em sequência**. Não embrulhar vários aggregates numa transação Firestore (anti-pattern em ES — cada aggregate é sua fronteira de consistência). Recuperação por **compensação** (se um passo falha, emite o evento de desfazer do passo anterior + remove) e **erro à mostra** — nunca silencioso. Padrão de referência: `onboarding/actions.ts` (`createOrg`).
- **Aggregate atrás de kill-switch de gateway = converge domínio agora, E2E espera.** Pra aggregates gated por `isPaymentsGatewayEnabled` (charge, split/subconta — parceria em stand-by): modelar eventos + reducer + **teste de replay** + unit normalmente; o **E2E desses fluxos específicos espera a parceria** ligar o gateway. Não bloqueia as outras fatias.

**Ordem de conformidade quando o aggregate é tocado por uma cascata:** conforme os aggregates-folha **antes** do que integra. Ex.: comissão/caixa/agenda antes do **fechamento da comanda** (que depende deles). E **não conformar aggregate que uma mudança de produto vai deletar** — sequencie a mudança de produto primeiro (ex.: caixa só depois de [[0015]] tirar abrir/fechar).

## RBAC

Papéis: `owner`, `manager`, `professional`, `receptionist`.

- `canManageOrg(role)` / `canInviteMembers(role)` em `@oilio/shared`.
- `assertRole(membership, ...allowed)` / `assertCanManage(membership)` em `@/shared/org/membership.ts` lançam `AuthzError` quando role insuficiente.

## Agenda — timezone

**Storage sempre UTC, display sempre em org timezone.** Helpers canônicos em `@oilio/shared/utils/timezone`. **Nunca use `getUTCHours()`/`getHours()` direto em código de agenda/comanda** — sempre passe pela conversão.

Detalhes (helpers, invariants, limitações) em [`docs/timezone.md`](../docs/timezone.md).

## Invite flow

1. Owner/manager cria invite via `/(app)/team` → server action gera token random, armazena hash (sha256) + email + role + expiresAt em `orgs/{tid}/invites/{id}`.
2. Link: `/invites/{orgId}/{inviteId}?token={raw}`.
3. Aceitar valida hash + expiry + email match e cria Membership server-side.

## Forms + Server Actions

Toda mutation server-side **deve** ser disparada por `<form action={serverAction}>` com `<button type="submit">`. Pattern canônico + anti-patterns banidos em [`PATTERNS.md` § Forms + Server Actions](../../../PATTERNS.md#forms--server-actions-progressive-enhancement). Refs: incidente #763, refactor #936.

## Testes

Convenções universais em [`TESTING.md`](../../../TESTING.md). Especificidades do scheduling (Playwright layout, emulator, isolation, rules integration) em [`docs/e2e-conventions.md`](../docs/e2e-conventions.md). Como rodar (e o que cada script sobe sozinho) em [`../README.md` § Scripts](../README.md#scripts).

**Mocks de Firestore são proibidos** — sempre hit emulator pra rules-bound tests (regra do monorepo).

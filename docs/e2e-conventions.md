# E2E conventions — scheduling/web

Referenciado de `apps/web/CLAUDE.md` § Testes. Consulte ao adicionar/calibrar specs Playwright.

Convenções universais em `TESTING.md` (raiz do monorepo) § "Playwright — convenções". Este doc cobre o que é específico de `scheduling/web`.

## Layout

- **Centralizado**: `tests/e2e/<feature>/` (não co-localizado com a rota). `journeys/` pra specs cross-cutting.

## Setup

- **Stack Supabase local obrigatório**: `pnpm --filter @oilio/web db:start` antes do `test:e2e` (API `:55321`, Postgres `:55322`, Studio `:55323`). O runner (`scripts/e2e.ts`) aplica as migrations e sobe o Next (build de produção) conectado como `oilio_app` — o RLS vale no E2E como em prod.
- **globalSetup** em `tests/e2e/helpers/global-setup.ts`: health do Auth (`/auth/v1/health`) + query no Postgres do event store + resposta do stripe-mock, pra evitar cold-start race.
- **Stripe no E2E = `stripe-mock`** (`docker/stripe-mock.compose.yaml`, imagem pinada por versão + digest). O runner sobe um container por execução (porta livre, projeto compose próprio — suítes paralelas não colidem), aponta o client do app pra ele via `STRIPE_API_BASE` (só E2E; produção nunca seta, e o client recusa override com chave que não seja `*_test_*`) e derruba no fim. O mock valida cada request contra o OpenAPI do Stripe e devolve fixtures: um bump do SDK ou mudança no billing que quebre a API quebra o E2E. É stateless — nada escrito volta numa leitura; os specs (`tests/e2e/billing/stripe-integration.spec.ts`) asseveram o que o app renderiza/persiste a partir das fixtures (cartão Visa 4242, fatura, URLs de Checkout/portal, webhook assinado com o `STRIPE_WEBHOOK_SECRET` de `helpers/secrets.ts`).
- **Erro de billing no servidor = run vermelho.** O runner varre a saída do `webServer` e falha a execução se aparecer log `error` com escopo de billing (`billing-details`, `getUnitAdditionCost`, `syncStripeSubscriptionQuantity`, `startCheckout`, `cancelSubscription`, `stripe-webhook`) — esses caminhos degradam a UI em silêncio, então o spec sozinho não pegaria.
- **Login nos specs**: identidades criadas pela admin API do Supabase (`helpers/session.ts` — `createE2EIdentity` / `signInAndAttachSession`) e sessão via `/api/e2e-signin` (404 sem `ENABLE_TEST_AUTH=true`, setado só pelo `webServer` do Playwright).
- **Seed nos helpers** roda como `postgres` (dono), não como `oilio_app`. Env do stack em `helpers/app-env.ts`.
- **Isolation via org único por test** (`orgInput` fixture gera `e2e-org-${timestamp}-${random}`). Multi-org schema garante que workers paralelos nunca colidem.

## Integração Postgres (RLS, constraints, event store)

`*.pg.integration.test.ts` rodam contra um Postgres efêmero em docker (`docker/postgres.compose.yaml`); cada suíte cria o próprio banco e role de runtime. Não precisa do stack Supabase:

```bash
pnpm --filter @oilio/web test:integration   # event store
pnpm test:integration                       # @oilio/product
```

**Mocks de banco são proibidos** pra testes de RLS/constraint — sempre Postgres real.

## Inventário canônico de jornadas + matriz de cobertura (brief 0035)

A régua objetiva do que precisa de E2E ponta-a-ponta, por persona — não a fatia
isolada de uma AC, mas **o caminho que o usuário realmente faz**. Um bug básico
de redirect pós-login escapou porque a cadeia composta não tinha spec dedicado;
este inventário deixa de ser memória do agente e vira contrato revisável.

**Como ler:** `coberto` = jornada ponta-a-ponta afirmada por spec; `parcial` =
pedaços cobertos, falta a cadeia composta; `gap` = sem cobertura. Jornadas de
features em voo (0028–0041) **não se reescrevem aqui** — o inventário aponta pro
DoD do brief que as cobre (AC-10). Atualizar esta matriz ao adicionar/remover
jornada crítica (iterate rule do brief 0035).

### Owner / admin

| Jornada (ponta-a-ponta)                                                                                                                                          | Cobertura | Spec(s) / fonte                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Login → landing por estado** — autenticado em `/` → `/dashboard`; sem org → `/onboarding`; completion pendente → `/onboarding/profile`; com org → `/dashboard` | coberto   | `journeys/owner-login-landing.spec.ts` (#1076) + `onboarding/profile-completion.spec.ts` (estado pendente)                                   |
| **Onboarding just-in-time → operável** — signup → criar 1ª unidade/profissional/serviço pelos empty-state CTAs                                                   | coberto   | `journeys/owner-onboarding-to-operable.spec.ts` (#1076); DoD 0008 (`onboarding/feature-dod`, `app-usable-without-setup`, `empty-state-ctas`) |
| Contexto por unidade + navegação escopada                                                                                                                        | coberto   | DoD 0029/0039 (`journeys/{contexto-por-unidade,unit-context-scope,conformar-contexto-unidade}`)                                              |
| Equipe como superfície única (gerir membros)                                                                                                                     | coberto   | DoD 0037 (`journeys/equipe-superficie-unica`)                                                                                                |
| Offboarding de membro (cascata)                                                                                                                                  | coberto   | DoD 0041 (`team/member-offboarding-journey`)                                                                                                 |
| Navegação filtrada por papel                                                                                                                                     | coberto   | `nav-role-filter.spec.ts`                                                                                                                    |
| Empty-state protagonista                                                                                                                                         | coberto   | DoD 0034 (`empty-states/feature-dod`)                                                                                                        |
| Bloqueio no contexto (unidade/profissional)                                                                                                                      | coberto   | DoD 0036 (`blocks-context-dod`)                                                                                                              |

### Recepção / manager

| Jornada                                                   | Cobertura | Spec(s) / fonte                                                                                                                                                                          |
| --------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Convite → aceite (email match) → membership → landing** | coberto   | `invites/invite-flow.spec.ts` (aceite → vínculo → `/dashboard`) + `journeys/professional-membro.spec.ts` (convite de profissional → operável) — #1077 confirmou cobertura, sem spec novo |
| Recepção vende (operação)                                 | coberto   | DoD 0030 (`journeys/venda-multi-vertical`, Cenário 4)                                                                                                                                    |

### Profissional

| Jornada                                  | Cobertura | Spec(s) / fonte                                            |
| ---------------------------------------- | --------- | ---------------------------------------------------------- |
| Convite → aceite → perfil → operável     | coberto   | DoD 0028 (`journeys/professional-membro`)                  |
| Identidade/aprovação derivada por evento | coberto   | `team/{identity-derived,approval-derived}.spec.ts`         |
| Bloqueio do profissional                 | coberto   | DoD 0036 (`team/professional-block`, `blocks-context-dod`) |

### Cliente (self-booking público)

| Jornada                                                                     | Cobertura | Spec(s) / fonte                                                                                                                                               |
| --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Descobrir → escolher serviço/profissional/horário → confirmar → success** | coberto   | `journeys/customer.spec.ts` (wizard catálogo → disponibilidade → confirmar → success) + `self-book/wizard.spec.ts` — #1078 confirmou cobertura, sem spec novo |
| Auto-cancelamento dentro da janela                                          | coberto   | `me-self-cancel.spec.ts`                                                                                                                                      |
| Atribuição de origem (via/campaign)                                         | coberto   | `self-book/attribution.spec.ts`                                                                                                                               |
| Plano: escopo de booking (limite/horário/unidade)                           | coberto   | `self-book/plan-scope-*.spec.ts`                                                                                                                              |

### Operação (cross-persona)

| Jornada                                            | Cobertura | Spec(s) / fonte                                                                                                                                                                                |
| -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Venda aberta → itens → fechar → comissão/caixa** | coberto   | `order-flow.spec.ts` (início → adiciona produto → fecha → comissão) + DoD 0030/0031 (`journeys/venda-multi-vertical`, `financeiro-venda-relatorio`) — #1079 confirmou cobertura, sem spec novo |
| LGPD — anonimização/retificação/exclusão           | coberto   | DoD 0032 (`privacy/*`)                                                                                                                                                                         |

### Gaps (AC-04/AC-09)

**Nenhuma jornada crítica do comportamento shipado fica descoberta.** O único gap
real era a cadeia de **landing pós-login** (o bug) — preenchido em #1076
(`journeys/owner-login-landing.spec.ts` + `owner-onboarding-to-operable.spec.ts`).
As demais jornadas que o brief 0035 previa cobrir (#1077 convite, #1078
self-booking, #1079 venda) já estavam **cobertas por DoDs de features que shiparam
depois** (0028–0041; `journeys/` foi de 1 → 8 specs) — confirmado na auditoria, sem
spec duplicado (AC-09/AC-10). Jornadas novas que surgirem entram nesta matriz +
ganham spec (iterate rule).

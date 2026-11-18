# Testing

> Documento canônico do monorepo: filosofia + comandos + cobertura atual. Importado por referência via `@<path>` nos `CLAUDE.md` dos apps. Não duplique em workspaces — atualize aqui.

Solo dev context: every bug that escapes to production costs reputation directly. The strategy is to cover what matters at the right level — unit, integration, E2E, and smoke — with each tier doing its own job and not invading the others.

## Philosophy

A Testing Trophy ([Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)) adapted for this project, with smoke as a horizontal layer:

```
       /\
      /E2\        Few. Critical user journeys, real session.
     /----\
    /Integ.\     Most UI tests. Component + msw.
   /--------\
  /   Unit   \   Pure logic, schemas, hooks.
 /------------\
[    Smoke    ]  Post-deploy. "Is the app alive?" not "is it correct?"
```

Smoke sits outside the pyramid because it answers a different question: **is the app alive?** rather than **is it correct?**. It runs after deploy, against the real URL, and never substitutes E2E.

## The four levels

| Level           | Question it answers                                              | Where it lives                                                           | Speed         | When it runs                                             |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- | -------------------------------------------------------- |
| **Unit**        | Does this function/hook/component behave correctly in isolation? | Co-located (`Foo.tsx` ↔ `Foo.test.tsx`)                                  | ms            | Watch during dev; every PR                               |
| **Integration** | Does this component work with its dependencies (RTL + msw)?      | Co-located                                                               | ~100ms        | Every PR                                                 |
| **E2E**         | Can the user complete this critical real flow?                   | `_e2e/` per route **or** `tests/e2e/<feature>/` centralized (Playwright) | seconds       | Every PR (subset) + nightly (full)                       |
| **Smoke**       | Is the app alive and responding?                                 | `tests/smoke/` (root) or `apps/<x>/_smoke/`                              | <1s per check | **Post-deploy** against real URLs (preview + production) |

## When to use each

### Unit

- Pure logic: utils, validators, reducers, Zod schemas, data transformations.
- Custom hooks (`@testing-library/react-hooks` or equivalent).
- Components with non-trivial conditional logic isolated from external dependencies.

### Integration

- Component + msw mocking the network.
- Forms (renders, fills, submits, asserts mocked API call).
- The majority of UI tests live here.

### E2E (Playwright)

- **Only** critical business flows that cross multiple routes / use real session state: login, signup, checkout, onboarding, the main product flow.
- Tests **real user behavior**, not internal state. See `## E2E selectors` for the locator policy.
- Does not duplicate what unit/integration already covers. If a scenario can be tested with msw at the integration level, **it goes there**.

### Smoke

- Post-deploy, against real URLs (preview deployment and production).
- Broad and shallow checks: home returns 200, healthcheck endpoint responds, login page renders, assets load, security headers present.
- **No login**, no flow, no test data — only "is it alive?".
- Runs in seconds. Failure = block promote / alert.

## Cobertura mínima por feature (baseline — não-negociável)

Toda feature de **UI/CRUD** carrega um baseline E2E **por construção**, independente dos journeys específicos do DoD. O contrato canônico mora na **skill de produto** (não só aqui): [`lyra/skills/_shared/min-test-coverage.md`](https://gitlab.com/cbrl/lyra/-/blob/main/skills/_shared/min-test-coverage.md) + [princípio #17](https://gitlab.com/cbrl/lyra/-/blob/main/skills/product/PRINCIPLES.md#17). O pipeline (`/feature` → `/feature-issues` → `/implement`) injeta e cobra esse baseline; `/product-audit feature-min-coverage` aponta as features sem ele.

Baseline (template de referência: `tests/e2e/customers/baseline.spec.ts`):

- **Render + empty state** — tela abre autenticada e sem dados, sem 500.
- **Criar pelo fluxo real da UI** → aparece na listagem.
- **Editar** → reflete.
- **Excluir** → some e a lista volta a renderizar.
- **≥1 dado degenerado** — campo opcional ausente / entidade sem vínculo (o que o seed "perfeito" esconde).

> Por que existe: o bug `/customers` 500 (2026-05-28) — 3 bugs triviais (userId nulo, tags undefined, id vazio + ressurreição de projeção no `appendEvent`) que o seed idealizado do journey escondia. Seed realista + cobrir criar→render→excluir é o que pega essa classe.

## Anti-patterns

- **Smoke disguised as E2E**: `await page.goto('/'); await expect(page.getByText('Welcome')).toBeVisible()` saved under the E2E folder (`_e2e/` or `tests/e2e/`). That's smoke. Either move it to `_smoke/`, or expand it into a real flow with assertions on user-visible outcomes.
- **E2E testing unit logic**: regex email validation in Playwright. Belongs in the Zod schema's unit tests.
- **Unit that mocks everything**: if you mocked all the dependencies, what's left to test? If it's pure logic, the mock shouldn't exist; if it's not, it's a poorly written integration test.
- **Coverage as a goal**: 100% line coverage proves nothing if the tests don't assert behavior. The metric that matters is "bugs that escape", not "lines covered".

## Granularity

Each test has **one** clearly named responsibility. If the name needs an "and" (`logs in and updates profile and ...`), it's either two tests or it belongs at a different level.

## Test discipline

- **Single command.** The unit + integration suite runs from the repo root with `pnpm --filter "@<scope>/*" test` (delegates to each workspace's `test` script). E2E runs with `pnpm --filter @<scope>/web run test:e2e`. Smoke runs post-deploy in CI against real URLs. If a test needs manual setup before it runs, that's a bug in the setup, not a thing to document as a workaround.
- **Every new function gets a test.** A public function shipped without a test is incomplete. A bug fix shipped without a regression test that reproduces the bug is incomplete — the regression test is the proof the bug stays fixed.
- **Named fakes, not inline stubs.** When mocking external I/O outside HTTP (DB, filesystem, queues), build a named fake reusable across tests (`FakeMailer`, `FakeStorage`) instead of scattering ad-hoc `vi.fn()` per test. msw already covers HTTP. Inline stubs duplicate setup and rot independently across tests.
- **F.I.R.S.T.** Fast (unit/integration in milliseconds, not seconds), Independent (no order coupling, no shared mutable fixtures across tests), Repeatable (no flake from clocks, network, or ordering — fix the test, don't retry it), Self-validating (the test asserts; no `console.log` for the human to eyeball), Timely (written with the feature, not bolted on months later).
- **Integration com DB**: hit Postgres real (efêmero em docker, `docker/postgres.compose.yaml`; o `test:integration` sobe sozinho), nunca mock o banco — mocks divergem do real e mascaram regressões de migration, constraint e RLS.
- **Co-localização**: `Foo.tsx` ↔ `Foo.test.tsx` no mesmo diretório (não em `__tests__/`).

## Playwright — source of truth

**Source of truth canônica é a doc oficial: [playwright.dev/docs/best-practices](https://playwright.dev/docs/best-practices).** Antes de escrever, revisar ou debugar qualquer spec E2E, consulte essa página. Não improvise de memória — a API evolui e os pitfalls listados lá pegam ~90% dos problemas comuns.

As subseções da doc oficial cobrem (resumo do que você encontra lá):

- **Use locators** — `getByRole`, `getByLabel`, `getByText`, `getByTestId`. Priorize role-based; testid só quando nada do user-facing serve.
- **Generate locators** — `npx playwright codegen` pra inspecionar a página viva e copiar o locator certo. Não chute selector.
- **Use web-first assertions** — `await expect(locator).toBeVisible()` em vez de `await locator.isVisible()` (retorna boolean, não espera).
- **Configure debugging** — `--debug` / `--ui` / `--headed` / `trace: 'retain-on-failure'`. Quando spec falha localmente, primeiro rode com `--debug`, não toque no código.
- **Use Playwright's tooling** — VS Code extension, UI mode, trace viewer.
- **Test isolation** — cada teste em browser context fresh; sem state compartilhado.
- **Avoid testing third-party dependencies** — mocke a network boundary, não o seu código.
- **Test on production-equivalent environment** — `next build && next start`, não `next dev`. Detalhado em ["Production build pro E2E"](#production-build-pro-e2e-nextjs-apps) abaixo.

**Regra prática:** se você se encontrar inventando uma abordagem que não está em [playwright.dev/docs/best-practices](https://playwright.dev/docs/best-practices), pare e releia a página antes de continuar. Se ainda assim a abordagem fizer sentido, abra issue documentando o caso e propondo um pattern; não codifique gambiarra silenciosa.

**Tooling local:**

- `eslint-plugin-playwright` com config `recommended` — discourages raw locators, element handles, raw selectors. Já catch a maioria dos anti-patterns em PR.
- Playwright MCP server — pra inspecionar DOM vivo enquanto escreve spec.
- `npx playwright codegen <url>` — grava interação e gera locators canônicos.
- `pnpm exec playwright test --ui` — modo interativo, time-travel debugger.

**Quando a doc oficial não cobre um caso específico** (raro), fallback é [Testing Library's query priority](https://testing-library.com/docs/queries/about/#priority) — alinhado com Playwright em filosofia (locate by user-visible behavior).

**Por que isto importa**: um spec verde com locator que o usuário nunca toca é pior que ausência de teste — produz falsa sensação de cobertura. Os locators role/label/text bind a sua suite ao **comportamento** que o usuário experimenta; CSS classes e generated IDs bind a sua suite ao **DOM atual**, que muda com refactor de styling.

## Playwright — convenções

### Organização de specs

Dentro de `tests/e2e/` (layout centralizado):

```
tests/e2e/
├── <feature>/               # uma pasta por feature (agenda/, self-book/, cash/...)
│   ├── <scenario>.spec.ts
│   └── ...
├── journeys/                # specs cross-cutting (não pertencem a 1 feature)
│   └── customer.spec.ts     # ex.: jornada do cliente final ponta-a-ponta
├── helpers/                 # seed helpers, REST clients, date utils — pt-BR description, English code
│   ├── session.ts
│   ├── date.ts
│   └── global-setup.ts
├── pages/                   # Page Object Models (POM)
└── fixtures.ts              # Playwright fixtures (test.use, custom fixtures)
```

**Sem prefix `_`** em folder names — herança do Next.js que só vale dentro de `src/app/`. Em `tests/e2e/` não há routing → `helpers/` em vez de `_helpers/`.

**Singletons** (1 spec sem feature cluster) podem ficar no root de `tests/e2e/`. Promover pra folder quando virar 2+.

### Tags semantics

Tags servem **eixos ortogonais** que folder structure não expressa (per [doc oficial](https://playwright.dev/docs/test-annotations#tag-tests)). Feature **não** vai em tag — feature mora no path.

| Tag         | Significado                                                                              | Quando rodar          |
| ----------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `@smoke`    | Subset minúsculo + rápido: "is the app alive?" — 5-10 testes, segundos                   | Cada PR (gate barato) |
| `@critical` | Regras de negócio que NÃO podem quebrar (cancellation policy, invite token, double-book) | Pre-merge             |
| `@journey`  | Jornadas end-to-end cross-feature (cliente faz signup→book→cancel)                       | Pre-merge, pós-deploy |

Scripts npm canônicos no `package.json` do app:

```json
"test:e2e:smoke": "playwright test --grep @smoke",
"test:e2e:critical": "playwright test --grep @critical",
"test:e2e": "playwright test"
```

Aplicar tag no `test.describe()` propaga pra todos children. Múltiplas: `{ tag: ['@journey', '@smoke', '@critical'] }`.

### globalSetup — pre-condições de infra

Toda suíte E2E backed por DB/Auth deve ter `globalSetup` que faz **write→query round-trip** antes do primeiro teste. Por quê: probe de URL (`webServer.url`) só confirma que porta tá bindada, não que index/auth está query-ready. Isso expõe race em testes que fazem seed→action-query rápido.

Padrão canônico (ver `apps/web/tests/e2e/helpers/global-setup.ts`):

```ts
// playwright.config.ts
globalSetup: './tests/e2e/helpers/global-setup.ts',

// global-setup.ts (resumo)
export default async function globalSetup() {
  await Promise.all([
    waitFor('Auth',       tryAuthHealth),            // /auth/v1/health do Supabase local
    waitFor('EventStore', tryEventStoreRoundtrip),   // conecta no Postgres + query
  ])
  // Throw com timeout 30s se o stack local estiver unhealthy — falha alto, não vira flake
}
```

Princípios:

- Roda **1 vez** após `webServer` ficar pronto, antes do 1º teste.
- Custo <500ms quando o stack está saudável; throw fast se não.
- **Não é gambiarra** — é a primitiva oficial PW pra pré-condições. Vence `sleep` no teste, retry escondido, ou flake mascarado.

### Test independence + sem retry

Test isolation via namespacing (UUID/timestamp prefix em todo ID gerado por seed) é o padrão canônico em E2E paralelo — não tente cleanup-between-tests (workers brigam).

`retries: 0` em todo config. Retry mascara flake. Se pisca: conserta na fonte ou marca `test.fixme()` + issue.

### Linguagem das descrições

`test.describe()` / `test()` titles em **pt-BR**; termos técnicos / brand names / acronyms preservados. Filename e code identifiers continuam English kebab-case / camelCase (regra cross-project do monorepo).

## Comandos

```bash
# Raiz do monorepo
pnpm test                                                # Vitest em todos workspaces (unit + integration)
pnpm run test:e2e                                        # Playwright em todos workspaces que têm
pnpm run test:smoke                                      # Smoke configs (post-deploy)

# Per-workspace
pnpm --filter ./apps/<x> test
pnpm --filter ./apps/<x> run test:e2e
pnpm --filter ./apps/<x> run test:e2e:ui                 # UI mode interativo (quando disponível)
pnpm --filter ./apps/<x> run test:smoke -- --base-url=https://staging.example.com
```

`pnpm -r run` pula workspaces que não declaram o script — rodar `test:e2e` na raiz não falha em apps sem Playwright.

## E2E local

```bash
npx playwright install                                   # Setup uma vez. Browsers em ~/.cache/ms-playwright/

pnpm --filter ./apps/<x> run test:e2e
# Playwright spawna o servidor automaticamente via `webServer` config.
# Se já tiver o servidor rodando, `reuseExistingServer` reaproveita.
```

Cada app escolhe **um** de dois layouts (consistente dentro do app):

- **Co-localizado com a rota** — `apps/<x>/src/.../_e2e/<feature>.spec.ts`. Default histórico do monorepo. Mantém spec perto da rota que testa; bom quando o número de specs por rota é pequeno e a cobertura cresce junto com o produto. Adotado em `focusely`, `cbrl.dev`, `gabar`, `imovil`.
- **Centralizado por feature** — `apps/<x>/tests/e2e/<feature>/<scenario>.spec.ts`. Boa quando o número de specs cresce a ponto de a co-localização gerar pastas `_e2e/` por todo lado e/ou specs cross-cutting (`journeys/`) não terem rota única. Adotado em `scheduling`.

Listar todos os specs E2E do monorepo:

```bash
find apps \( -path "*/_e2e/*.spec.ts" -o -path "*/tests/e2e/*.spec.ts" \) -not -path "*/node_modules/*"
```

Smoke configs (`playwright.smoke.config.ts`) **não** spawnam dev server — testam contra URL real:

```bash
pnpm --filter ./apps/focusely run test:smoke -- --base-url=https://focusely.web.app
```

## Production build pro E2E (Next.js apps)

**Regra**: o `webServer` de Playwright em apps Next.js deve apontar pra **`next build && next start`** (build de produção), não `next dev`. `E2E_DEV=1 pnpm test:e2e` é o opt-in pra usar dev mode durante iteração local de spec novo.

**Por quê** — `next dev` (com ou sem Turbopack) tem três fontes de race que produção não tem:

- **Hydration lenta**: chunks de JS fragmentados, carregados sob demanda, com source maps. Produção é bundle estático pré-compilado.
- **HMR overlay**: o websocket de hot reload intercepta eventos. Já vimos click engolido por isso (incidente #763).
- **First-compile**: a primeira request a uma rota compila-a on-demand. Turbopack às vezes serve HTML antes do JS estar pronto.

Production build elimina os três. É o que [Playwright recomenda oficialmente](https://playwright.dev/docs/best-practices#test-on-production-equivalent-environment) e o que a Vercel orienta pra E2E em Next.js.

**Trade-off**: ~60–90s de cold build antes da suite começar. Compensa runs deterministicos (testes que passam de primeira). Cache local de build acelera reruns.

**Config canônica executável** vive em [`templates/web/playwright.config.ts`](templates/web/playwright.config.ts) — novos apps herdam ao rodar `pnpm run new:app`. Apps já existentes alinham com esse arquivo conforme atualizam.

Pontos load-bearing (`why` mora inline nos comentários do template):

- `command: USE_DEV_SERVER ? 'pnpm run dev' : 'pnpm run build && pnpm exec next start ...'`
- `timeout` ~300s pra acomodar cold build
- `reuseExistingServer: !process.env.CI`

**`retries: 0`**: nunca configure auto-retry em E2E. Retries mascaram flake — duplicam CPU pra esconder bug que cliente real sente. Se um teste pisca, conserte na fonte (geralmente é `<button onClick async>` sem form action — veja [`PATTERNS.md` § Forms + Server Actions](./PATTERNS.md#forms--server-actions-progressive-enhancement)).

## Forms progressively-enhanced são pré-requisito de E2E confiável

Se a feature usa `<button onClick={async () => { await action(); router.push() }}>`, o E2E vai flakeae mesmo em production build — o click depende de hydration estar pronta. O fix está em `PATTERNS.md`: toda mutation server-side vai por `<form action={serverAction}>`. O form submete nativamente; click funciona desde o primeiro byte de HTML.

**Sintomas que indicam que a feature precisa virar form action**:

- Você está esperando `waitForLoadState('networkidle')` antes de cada click.
- Você tem `expect.toPass({ retries })` em volta de click+assert.
- Você adicionou `--retries=2` no config "pra estabilizar".
- Você usa `data-testid` só pra esperar hydration (`await page.locator('body[data-hydrated]').waitFor()`).

Tudo isso são gambiarras pra mascarar hydration race. A correção é converter a feature pro pattern em [`PATTERNS.md`](./PATTERNS.md#forms--server-actions-progressive-enhancement) — não escalar a gambiarra.

## Pre-push

`.husky/pre-push` roda `pnpm run typecheck && pnpm test` (typecheck + Vitest unit/integration). **Não** roda E2E (lento demais — build do Next + boot do Playwright). Rode E2E manualmente antes de abrir PR pra fluxos que tocam UI.

## Cobertura atual (2026-05-15)

| Workspace            | Unit + integration | E2E (specs / tests) |
| -------------------- | ------------------ | ------------------- |
| apps/cbrl.dev        | 7                  | 1 / 1               |
| apps/focusely        | 29                 | 1 / 1               |
| apps/oilio/web       | 23                 | 7 / 13              |
| apps/imovil          | 146                | 13 / 28             |
| apps/gabar/web       | 247                | 9 / 34              |
| apps/gabar/scraper   | 250                | —                   |
| apps/gabar/converter | 7                  | —                   |
| apps/gabar/enricher  | 51                 | —                   |
| packages/\*          | ~81                | —                   |

Total: ~848 unit + integration, 32 E2E specs / 78 E2E tests.

## Pré-requisitos por app pra E2E não falhar

| App              | Setup obrigatório antes do `test:e2e`                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/cbrl.dev    | nada — landing estática                                                                                                                              |
| apps/focusely    | nada — sem backend                                                                                                                                   |
| apps/web (oilio) | Stack Supabase local no ar (`pnpm --filter @oilio/web db:start`). O `test:e2e` aplica as migrations, builda e sobe o Next (como `oilio_app`) sozinho |
| apps/imovil      | `pnpm run db:start` (Firebase emulators) + `.env.local`                                                                                              |
| apps/gabar/web   | `.env.development.local` (com `NEXT_PUBLIC_FIREBASE_*` ou emulator)                                                                                  |

Sem o stack local/env, o `globalSetup` falha ("local Supabase may be down") ou o Playwright dá timeout em `config.webServer`. Não é falha do teste — é setup faltando.

## Where it plugs in

- O `CLAUDE.md` de cada app linka este documento (link Markdown comum, **não** `@-import` — logo não fica always-loaded no contexto do agente; é doc de consulta).
- **CI ainda NÃO existe** (🔴 #939). Hoje o gate é local: `pre-push` roda typecheck + Vitest (unit/integration); **E2E é manual** antes da PR. Até o CI existir, o baseline (acima) é a defesa principal — rode os specs `*/baseline.spec.ts` na área tocada.
- Alvo (#939): CI rodando unit + integration + E2E (subset) em todo PR, bloqueando merge; smoke post-deploy; E2E full nightly.

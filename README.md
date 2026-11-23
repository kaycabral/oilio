# Oilio

Plataforma **B2B cross-category** pra negócios de serviço recorrente, com **assinatura como capacidade nativa e mais profunda** e **funil Tier 3 → Tier 2 → Tier 1 como produto** — sem excluir quem opera em Tier 2 (recorrência informal) ou Tier 3 (avulso). Multi-tenant, multi-vertical cruzando categorias estruturalmente diferentes (**Barbearia + Estética Automotiva** ativos hoje; arquitetura pronta pra pet, fitness, autocenter). Codinome `scheduling`; nome final do produto será definido antes do lançamento.

## Documentação

A [Wiki do projeto](https://github.com/cbrl-dev/cbrl/wiki) é a **fonte canônica** de decisões estratégicas, visão de produto, roadmap, análise competitiva e dores dos clientes-âncora.

Docs técnicos locais:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — stack real (Next.js 16 + Supabase/Postgres na Vercel), workspaces, fluxo de dados.
- [`docs/decisions/`](./docs/decisions/) — ADRs específicos do scheduling.
- [`TESTING.md`](./TESTING.md) — filosofia de testes canônica.
- [`PATTERNS.md`](./PATTERNS.md) — padrões de código canônicos.

## Pré-requisitos

- **Node** na versão do `.nvmrc` (26 LTS) e **pnpm** na versão do `packageManager` (o Node 26 não traz Corepack: instale o pnpm à parte). Depois: `pnpm install` na raiz.
- **Docker** — o stack Supabase local (Postgres + Auth) e as suítes de integração rodam em containers.
- **Supabase CLI** (`supabase`) no `PATH` — usado pelo `db:start`/`db:stop`.

## Scripts

Todos rodam da raiz do repositório.

```bash
# Stack Supabase local (Docker): API 55321, Postgres 55322, Studio 55323.
# Config em apps/web/supabase/config.toml. Aplica as migrations e dá login
# local ao role oilio_app (o app conecta como ele, então o RLS vale em dev).
pnpm --filter @oilio/web run db:start

# Grava URL/chaves do stack local no apps/web/.env.local (cria a partir do
# .env.example se faltar; preserva as outras linhas).
pnpm --filter @oilio/web run db:env

# Reaplica as migrations no stack local (event store + @oilio/product).
pnpm --filter @oilio/web run db:migrate:local

# Derruba o stack.
pnpm --filter @oilio/web run db:stop
```

```bash
# Next.js dev server (porta 3005) — com o stack local no ar
pnpm --filter @oilio/web run dev
```

```bash
# Build de produção
pnpm --filter @oilio/web run build
```

```bash
# Typecheck em todos os workspaces
pnpm typecheck
```

```bash
# Vitest (unit)
pnpm --filter @oilio/web run test
```

```bash
# Integração Postgres (Postgres efêmero em docker, docker/postgres.compose.yaml;
# cada suíte cria o próprio banco e role de runtime)
pnpm test:integration                       # @oilio/product
pnpm --filter @oilio/web run test:integration   # event store
```

**O `test:e2e` exige o stack local no ar** (`db:start`). O runner (`apps/web/scripts/e2e.ts`) aplica as migrations, builda e sobe o Next em modo produção conectado como `oilio_app` (o RLS vale como em prod) e roda o Playwright. O login nos specs passa pela rota de teste `/api/e2e-signin`, que só existe com `ENABLE_TEST_AUTH=true` — setado apenas pelo `webServer` do Playwright.

```bash
# Playwright (E2E) — chromium é o único projeto ativo.
pnpm --filter @oilio/web run test:e2e
pnpm --filter @oilio/web run test:e2e:critical   # só @critical (subset local; o CI roda a suíte completa)
```

**Dados de teste prontos pra desenvolvimento manual.** Em vez de recriar
tenant, serviços e agendamentos na mão toda vez, rode o seed: cria a
**Barbearia do Zé** (2 unidades, 4 serviços, 3 profissionais, 4 clientes,
agendamentos de ontem/hoje/amanhã, 1 plano + assinatura) e as demais orgs de
exemplo. É idempotente e os agendamentos são recalculados relativos a _hoje_ a
cada execução.

```bash
# Pré-requisito: stack local no ar (db:start) e .env.local gerado (db:env).
pnpm --filter @oilio/web run db:seed
```

Pra entrar: as personas semeadas (ex.: **Zé Owner**, `dev@cbrl.local`) têm
identidade no Auth local com senha `oilio-local-dev`. Login por email/senha só
existe no stack local — produção é só Google. A tela `/login` só oferece Google;
pra entrar como persona, ponha `ENABLE_TEST_AUTH=true` no `apps/web/.env.local`
(nunca em Vercel) e, com o app aberto em `http://localhost:3005`, rode no console
do browser:

```js
await fetch('/api/e2e-signin', {
  method: 'POST',
  body: JSON.stringify({ email: 'dev@cbrl.local', password: 'oilio-local-dev' }),
})
```

e recarregue a página. Pra testar o cadastro do zero, é
só criar uma conta nova normalmente — o seed é aditivo e não toca em contas que
não criou.

Produção (Vercel + Supabase, migrations só pelo CI): ver [`docs/production.md`](./docs/production.md).

## Origem e pendências

Extraído do monorepo `cbrl` em 2026-11-17 com histórico (`git filter-repo`): `apps/oilio/web` → `apps/web`, `apps/oilio/docs` → `docs`, `packages/product` mantido. As cópias vendorizadas (`@oilio/{tsconfig,eslint-config,env,testing,design,db}`) foram substituídas pelos pacotes publicados no npm `@cbrl/{tsconfig,eslint-config,prettier-config,commitlint-config,env,testing,design,pg}` (fonte: `kaycabral/toolkit`); só `packages/product` segue local. Depois, as cópias de auth Supabase, headers/CSP, logger, utilitários BR e helpers de Postgres também foram trocadas por `@cbrl/{supabase,next,log,br}` e `@cbrl/pg/drizzle`.

Em 2026-11-18 a produção saiu de GCP/Firebase pra Supabase + Vercel ([ADR 0020](./docs/decisions/0020-supabase-vercel.md)), e o CI/CD foi portado pro GitHub Actions (`.github/workflows/`): um pipeline reutilizável (`checks.yml`) chamado por PR, `main` e nightly, com `Deploy (migrate database)` e o smoke pós-deploy (`smoke.yml`, `Smoke (production)`) como gates do deploy da Vercel. Fluxo em [`docs/production.md`](./docs/production.md#fluxo-de-uma-mudança).

**Pendências:**

- Gates de qualidade do monorepo ainda fora do CI: knip, depcruise, type-coverage, mutation (Stryker) — os scripts existem (`pnpm knip`, `pnpm type-coverage`, `pnpm mutation`), mas não bloqueiam PR.
- Issues e a Wiki (briefs, PRDs) continuam no GitLab por enquanto.

## License

Proprietary. © 2026 cbrl-dev. All rights reserved. Ver [`LICENSE`](./LICENSE).

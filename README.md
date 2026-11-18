# Oilio

Plataforma **B2B cross-category** pra negócios de serviço recorrente, com **assinatura como capacidade nativa e mais profunda** e **funil Tier 3 → Tier 2 → Tier 1 como produto** — sem excluir quem opera em Tier 2 (recorrência informal) ou Tier 3 (avulso). Multi-tenant, multi-vertical cruzando categorias estruturalmente diferentes (**Barbearia + Estética Automotiva** ativos hoje; arquitetura pronta pra pet, fitness, autocenter). Codinome `scheduling`; nome final do produto será definido antes do lançamento.

## Documentação

A [Wiki do projeto](https://github.com/cbrl-dev/cbrl/wiki) é a **fonte canônica** de decisões estratégicas, visão de produto, roadmap, análise competitiva e dores dos clientes-âncora.

Docs técnicos locais:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — stack real (Firebase + Next.js 16), workspaces, fluxo de dados.
- [`docs/decisions/`](./docs/decisions/) — ADRs específicos do scheduling.
- [`TESTING.md`](./TESTING.md) — filosofia de testes canônica.
- [`PATTERNS.md`](./PATTERNS.md) — padrões de código canônicos.

## Pré-requisitos

- **Java 11+ (JRE)** — necessário pra rodar os Firebase emulators (Auth + Firestore). Em Ubuntu: `sudo apt-get install default-jre`. macOS: `brew install --cask temurin`. Verifique com `java -version`.
- **Node** na versão do `.nvmrc` e **pnpm** via Corepack (`corepack enable`). Depois: `pnpm install` na raiz.

## Scripts

Todos rodam da raiz do repositório.

```bash
# Next.js dev server (porta 3005)
pnpm --filter @oilio/web run dev
```

```bash
# Build de produção
pnpm --filter @oilio/web run build
```

```bash
# Typecheck em todos os workspaces do scheduling
pnpm --filter "@oilio/*" run typecheck
```

```bash
# Vitest (unit)
pnpm --filter @oilio/web run test
```

**O `test:e2e` sobe o ambiente sozinho.** Os Firebase emulators (Auth 9099 + Firestore 8080) são iniciados pelo `firebase emulators:exec` — que embrulha o Playwright e injeta os hosts/projeto do emulador no ambiente (`FIRESTORE_EMULATOR_HOST` etc., o padrão canônico do Firebase). O Next é iniciado pelo `webServer` do `playwright.config.ts` (`reuseExistingServer`) e herda esses hosts. Não precisa rodar `db:start` nem subir o dev server manualmente antes. O `test:integration` usa o mesmo `emulators:exec`.

```bash
# Playwright (E2E) — emulators:exec sobe os Firebase emulators + Playwright
# sobe o Next. chromium por default; --project=chromium é o único ativo.
pnpm --filter @oilio/web run test:e2e
```

```bash
# Firebase Emulators (Auth + Firestore) — só precisa rodar manualmente se
# quiser reaproveitar a instância entre vários `test:e2e` (mais rápido).
pnpm --filter @oilio/web run db:start

# Mata emulator quando a porta 8080 fica presa (quirk do firebase-tools
# que às vezes não desliga limpo).
pnpm --filter @oilio/web run db:stop
```

**Dados de teste prontos pra desenvolvimento manual.** O emulator guarda os
dados só em memória — ao matá-lo, tudo some. Em vez de recriar tenant, serviços
e agendamentos na mão toda vez, rode o seed: cria a **Barbearia do Zé**
(2 unidades, 4 serviços, 3 profissionais, 4 clientes, agendamentos de
ontem/hoje/amanhã, 1 plano + assinatura). É idempotente e os agendamentos são
recalculados relativos a _hoje_ a cada execução.

```bash
# Pré-requisito: emulator no ar (db:start) e, pra navegar, o dev server.
pnpm --filter @oilio/web run db:seed
```

Pra entrar: `/login` → **Continuar com Google** → escolha **Zé Owner**
(`dev@cbrl.local`) no picker do emulator. Pra testar o cadastro do zero, é só
criar uma conta nova normalmente — o seed é aditivo e não toca em contas que
não criou.

## Origem e pendências

Extraído do monorepo `cbrl` em 2026-11-17 com histórico (`git filter-repo`): `apps/oilio/web` → `apps/web`, `apps/oilio/docs` → `docs`, `packages/{db,product}` mantidos. As cópias vendorizadas (`@oilio/{tsconfig,eslint-config,env,testing,design,db}`) foram substituídas pelos pacotes publicados no npm `@cbrl/{tsconfig,eslint-config,prettier-config,commitlint-config,env,testing,design,pg}` (fonte: `kaycabral/toolkit`); só `packages/product` segue local. Issues, MRs e a Wiki (briefs, PRDs) continuam no GitLab por enquanto.

**TODO — CI/CD pesado, ainda não portado do GitLab** (o GitHub Actions hoje só roda `.github/workflows/ci.yml`: format, lint, typecheck, unit e build):

- Integração Postgres (`pnpm test:integration`, `apps/web` `test:integration:pg`/`test:integration:events:pg`) e E2E Playwright (`@critical` em PR, suíte completa no release).
- Release via semantic-release (`apps/web/.releaserc.json` ainda usa `@semantic-release/gitlab`; tags `oilio-v*`).
- Deploy Cloud Run (`apps/web/Dockerfile`) + job de migração, autenticação keyless via WIF.
- Gates de qualidade do monorepo: knip, depcruise, type-coverage, mutation (Stryker), catraca de cobertura e badges.

## License

Proprietary. © 2026 cbrl-dev. All rights reserved. Ver [`LICENSE`](./LICENSE).

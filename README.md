# Oilio

[![pipeline](https://gitlab.com/cbrl/cbrl/badges/main/pipeline.svg)](https://gitlab.com/cbrl/cbrl/-/pipelines)
[![coverage](https://img.shields.io/endpoint?url=https://cbrl.gitlab.io/cbrl/badges/coverage-scheduling-web.json)](https://gitlab.com/cbrl/cbrl/-/pipelines)
[![mutation](https://img.shields.io/endpoint?url=https://cbrl.gitlab.io/cbrl/badges/mutation.json)](https://gitlab.com/cbrl/cbrl/-/pipelines)
[![type-coverage](https://img.shields.io/endpoint?url=https://cbrl.gitlab.io/cbrl/badges/type-coverage.json)](https://gitlab.com/cbrl/cbrl/-/pipelines)

Plataforma **B2B cross-category** pra negócios de serviço recorrente, com **assinatura como capacidade nativa e mais profunda** e **funil Tier 3 → Tier 2 → Tier 1 como produto** — sem excluir quem opera em Tier 2 (recorrência informal) ou Tier 3 (avulso). Multi-tenant, multi-vertical cruzando categorias estruturalmente diferentes (**Barbearia + Estética Automotiva** ativos hoje; arquitetura pronta pra pet, fitness, autocenter). Codinome `scheduling`; nome final do produto será definido antes do lançamento.

## Documentação

A [Wiki do projeto](https://github.com/cbrl-dev/cbrl/wiki) é a **fonte canônica** de decisões estratégicas, visão de produto, roadmap, análise competitiva e dores dos clientes-âncora.

Docs técnicos locais:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — stack real (Firebase + Next.js 16), workspaces, fluxo de dados.
- [`docs/decisions/`](./docs/decisions/) — ADRs específicos do scheduling.
- [`TESTING.md`](../../TESTING.md) — filosofia de testes canônica do monorepo.

## Pré-requisitos

- **Java 11+ (JRE)** — necessário pra rodar os Firebase emulators (Auth + Firestore). Em Ubuntu: `sudo apt-get install default-jre`. macOS: `brew install --cask temurin`. Verifique com `java -version`.
- **Pré-requisitos globais do monorepo** (Node, pnpm via Corepack) ficam no [README raiz](../../README.md).

## Scripts

Todos rodam da raiz do monorepo.

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

## License

Proprietary. © 2026 cbrl-dev. All rights reserved. Ver [`LICENSE`](../../LICENSE) na raiz do monorepo.

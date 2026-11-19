@AGENTS.md

# oilio

Plataforma B2B pra negócios de serviço recorrente. Visão geral e scripts em @README.md; arquitetura em `ARCHITECTURE.md`; decisões em `docs/decisions/` (ADRs).

Cada workspace (`apps/web`, `packages/*`) tem `CLAUDE.md` próprio quando há regras locais — abra antes de editar arquivos dentro dele. O app vive em `apps/web` (regras em `apps/web/CLAUDE.md`).

## Regras invioláveis

1. **Next.js: leia a doc local antes de codar.** `node_modules/next/dist/docs/` é a fonte de verdade; o conhecimento de treino está defasado.
2. **pnpm apenas.** Nunca `npm`/`yarn`/`bun`. Versões compartilhadas vivem no `catalog` do `pnpm-workspace.yaml` — bump = 1 linha + `pnpm install`.
3. **Aliases.** `@/...` dentro do workspace, `@oilio/<pkg>` entre workspaces, `@cbrl/<pkg>` pros pacotes compartilhados do npm. Nunca `../../`.
4. **Codebase em inglês.** Identificadores, mensagens de erro, logs, nomes de eventos.
5. **Zero comentário no código** (ADR 0018): `cbrl/no-non-doc-comments` é `error` em `apps/web`.
6. **ESLint: nunca desabilitar.** Sem `eslint-disable*`. Dívida antiga vive no `eslint-suppressions.json` do workspace (catraca: violação nova falha); `apps/web` não aceita suppressions.
7. **Tipagem sem escape hatch.** Sem `any`, `as any`, `as unknown as X`, `@ts-ignore`.
8. **Sem merge sem evidência de execução real** (spec E2E, log de `pnpm test` cobrindo o caminho, ou smoke manual descrito no PR). Ver `TESTING.md`.

## Gates

```bash
pnpm format:check
pnpm lint             # eslint por workspace (turbo) + scripts da raiz
pnpm typecheck
pnpm test             # vitest por workspace
pnpm build
pnpm test:integration # @oilio/product + gate do web contra Postgres efêmero (docker)
pnpm --filter @oilio/web test:integration   # event store contra Postgres
pnpm test:e2e         # Playwright contra o stack Supabase local (exige db:start)
```

## Não-óbvio

- **Linker isolado do pnpm** (sem `node-linker=hoisted`): toda dependência importada precisa estar declarada no `package.json` do workspace que a importa.
- **Deploy**: Vercel (`gru1`, Root Directory `apps/web`, build `turbo run build`) + Supabase (Postgres + Auth, `sa-east-1`). Migrations só pelo CI (job `deploy`, gate do deploy) — ninguém migra prod da máquina local. Runbook: [`docs/production.md`](docs/production.md). O turbo roda em modo estrito: env nova de build/runtime precisa entrar em `apps/web/turbo.json` (`env`/`passThroughEnv`).
- **Postgres**: dev/seed/E2E no stack Supabase local (`pnpm --filter @oilio/web db:start`/`db:stop`, Docker; app conecta como `oilio_app`, então o RLS vale como em prod). As suítes de integração usam um Postgres efêmero próprio (`docker/postgres.compose.yaml`, resolução de conexão em `scripts/oilio-pg-lib.mjs`).
- **Origem**: extraído do monorepo `cbrl` em 2026-11-17 com histórico (`git filter-repo`). Tooling e infra compartilhados (`@cbrl/{tsconfig,eslint-config,prettier-config,commitlint-config,env,testing,design,pg}`) vêm do npm (fonte: `kaycabral/toolkit`); só `packages/product` é local. Issues e Wiki seguem no GitLab por enquanto. CI no GitHub Actions (`.github/workflows/`, fluxo em `docs/production.md`); gates ainda fora do CI em README § Origem e pendências.

# Architecture

## Stack

- **Monorepo**: pnpm workspaces (`apps/web`, `packages/product`); tooling compartilhado vem do npm (`@cbrl/*`).
- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn (Radix UI).
- **Auth**: Supabase Auth, só Google (OAuth PKCE via `@supabase/ssr`). O servidor confia só em `getClaims()` (JWT verificado); sessão renovada no `src/proxy.ts`.
- **DB**: Postgres no Supabase — event store + projeções (`@/shared/db`) e a base de produtos (`@oilio/product`) no mesmo banco, journals de migration separados. App conecta como `oilio_app` (só DML, `NOBYPASSRLS`); isolamento por org via RLS.
- **Deploy**: Vercel (`gru1`) + Supabase (`sa-east-1`); migrations só pelo CI (GitHub Actions). Runbook: [`docs/production.md`](./docs/production.md); decisão: [ADR 0020](./docs/decisions/0020-supabase-vercel.md).
- **Testing**: Vitest (unit, co-located `*.test.tsx`; integração contra Postgres efêmero) + Playwright (E2E em `apps/web/tests/e2e/`, contra o stack Supabase local).
- **Node**: 26 LTS (see `.nvmrc`; `engines.node` is `26.x`).

## Workspaces

| Workspace          | Purpose                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js app (`@oilio/web`). Routes, UI, auth, event store + projeções, migrations (`drizzle/`). |
| `packages/product` | Base soberana de produtos (`@oilio/product`) — schema, migrations e acesso próprios.            |

## Data flow

```
browser ──(OAuth PKCE, Google)──► Supabase Auth
                                         │
                                         ▼ (code)
apps/web /auth/callback ──exchange──► cookies de sessão (@supabase/ssr)
                                         │
src/proxy.ts ──refresh──► sessão renovada a cada request
                                         │
RSC / actions / route handlers ──getClaims()──► SessionUser ──► Postgres como oilio_app (RLS)

crons (Vercel Cron, Bearer $CRON_SECRET) / webhooks (Stripe) ──► Postgres como oilio_app
```

## Aliases & folder pattern

See [`web/CLAUDE.md`](./apps/web/CLAUDE.md) — canonical for `@/*` vs `@oilio/*`, the full folder-pattern table, and the route-local vs promoted rules.

## When to scale

- **Vercel Hobby → Pro**: Hobby só agenda cron diário; notificações horárias (hoje atrás de flag desligada) exigem Pro.
- **Supabase**: acompanhar conexões do transaction pooler (6543), tamanho do banco e backups (point-in-time depende do plano).
- **Add workspaces** quando jobs em background precisarem de compute de longa duração (fora do limite de execução das funções da Vercel).

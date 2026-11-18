# Architecture

## Stack

- **Monorepo**: pnpm workspaces no monorepo cbrl (`apps/web`, `packages/oilio/{db,lib,shared}`), catalog em `pnpm-workspace.yaml` do root.
- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn (Radix UI).
- **Auth**: Firebase Auth (Google + Microsoft OAuth) with server-side session cookies signed by `firebase-admin`.
- **DB**: Firestore with Security Rules.
- **Deploy**: Firebase App Hosting (web) + Firebase (Auth/Firestore) — single-cloud on GCP, Blaze billing required.
- **Testing**: Vitest (unit, co-located `*.test.tsx`) + Playwright (E2E, `_e2e/*.spec.ts`).
- **Node**: 24+ (see `.nvmrc`).

## Workspaces

| Workspace               | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `apps/web`              | Next.js frontend (`@oilio/web`). Owns routes, UI, auth wiring.         |
| `packages/oilio/shared` | Types shared across 2+ workspaces (`@oilio/shared`). Pure TS, no deps. |
| `packages/oilio/db`     | Firebase Admin SDK accessor (`@oilio/db`). Backend only.               |
| `packages/oilio/lib`    | Operational utilities (`@oilio/lib`) — logger, env, http helpers.      |

## Data flow

```
browser ──(Web SDK)──► Firebase Auth + Firestore (rules enforced)
                                         │
                                         ▼ (ID token)
apps/web /api/session ──verify──► sets __session cookie
                                         │
RSC / route handlers ──read cookie──► verifySessionCookie via @oilio/db

server jobs/webhooks ──(service account)──► @oilio/db ──► Firestore (bypasses rules)
```

## Aliases & folder pattern

See [`web/CLAUDE.md`](./apps/web/CLAUDE.md) — canonical for `@/*` vs `@oilio/*`, the full folder-pattern table, and the route-local vs promoted rules.

## When to scale beyond Blaze free tier

- **Firestore quotas / Cloud Functions**: Blaze free tier covers small projects. Watch reads/writes and storage when traffic grows.
- **App Hosting**: bump `runConfig.maxInstances` and/or set `minInstances > 0` in `apps/web/apphosting.yaml` when cold starts hurt or peak load saturates a single instance.
- **Add workspaces** (`apps/oilio/worker`, `apps/oilio/api`) when background jobs need long-running compute — wire them to Cloud Run Jobs or Cloud Tasks via Pulumi.

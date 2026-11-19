# Produção

Runbook do ambiente de produção do oilio: o que roda onde, como mudança chega lá e o que fazer quando dá errado. Estado do ambiente e histórico: [ADR 0017](decisions/0017-oilio-em-producao.md); decisão da plataforma: [ADR 0020](decisions/0020-supabase-vercel.md).

## Topologia

| Peça                   | Onde                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| App (Next.js)          | Vercel, projeto `oilio`, Root Directory `apps/web`, domínio `www.oilio.com.br` |
| Funções (SSR, actions) | Vercel `gru1` (São Paulo), fixado em `apps/web/vercel.json`                    |
| Postgres + Auth        | Supabase, projeto `oilio` (`sa-east-1`, São Paulo)                             |
| Login                  | Só Google (provider Google do Supabase Auth)                                   |
| Pagamentos             | Stripe Billing (assinatura lojista → oilio), webhook `/api/webhooks/stripe`    |
| Crons                  | Vercel Cron (`apps/web/vercel.json`), `Authorization: Bearer $CRON_SECRET`     |
| Migrations             | GitHub Actions, job `deploy` do `main.yml`                                     |

**Ninguém acessa o banco de produção da própria máquina.** Dev, seed e E2E rodam no stack Supabase local (`pnpm --filter @oilio/web db:start`); a URL do banco de prod existe só no secret do GitHub e nas envs da Vercel.

### Roles do Postgres

| Role                                    | Uso                         | Privilégios                                                            |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `postgres`                              | migrations (CI)             | dono do schema                                                         |
| `oilio_app`                             | runtime do app (Vercel)     | só DML em `public`; `NOBYPASSRLS` — o RLS (`FORCE`) vale em toda query |
| `anon`, `authenticated`, `service_role` | API do Supabase (desligada) | nenhum privilégio em `public` (migration 0023)                         |

A Data API (PostgREST) fica **desligada** no projeto: o app fala com o Postgres direto. A secret key do Supabase só serve à API admin do Auth (exclusão de conta LGPD), que roda como `supabase_auth_admin`; mesmo vazada, não lê tabela do app.

### Identidade

`users.uid` é a identidade do app e é referenciada por todas as tabelas e pelo event store (imutável). Contas criadas no Supabase usam o próprio id do Auth como uid. Contas anteriores à migração (uid do Firebase) têm o uid antigo em `app_metadata.oilio_uid` — só o service role escreve ali, e o valor vem assinado no JWT. Ver `apps/web/src/shared/auth/session-user.ts`.

## Fluxo de uma mudança

1. PR → `pull-request.yml` roda o pipeline (`checks.yml`), tudo em paralelo: static (format, lint, typecheck, higiene de migrations: journal consistente, schema sem drift, migrations da `main` imutáveis); unit; integração Postgres (product e event store); **suíte E2E completa** em 4 shards no stack Supabase local; dependency review. O ruleset da `main` exige o check agregador `CI passed` e a branch atualizada antes do merge.
2. Merge na `main` → `main.yml`: o job `provenance` confirma pela API que a árvore do commit é idêntica à do head de um PR com `CI passed` verde (é o que o ruleset garante). Confirmado, não re-roda nada; não confirmado (push direto via bypass, PR desatualizado), roda o pipeline completo antes. Então `Deploy (migrate database)` aplica as migrations pendentes do event store e do `@oilio/product` (no-op quando não há). Commit não provado → `Deploy (migrate database)` **falha** em vez de ser pulado (um check "skipped" passaria no Deployment Check da Vercel).
3. A Vercel builda o mesmo commit e só promove pra produção depois do check `Deploy (migrate database)` passar (Deployment Checks). O código novo nunca entra no ar antes do schema que ele usa.
4. Toda noite `nightly.yml` roda o pipeline completo na `main` sem mudança (pega teste dependente de data, flake e drift de dependência). `scorecard.yml` mede a postura de supply chain (OpenSSF) toda semana.
5. Dependências: o Dependabot só propõe versões com 3+ dias de publicadas (`cooldown`; o pnpm aplica a mesma quarentena via `minimumReleaseAge`). Os grupos `minor-and-patch` (npm, sem as críticas) e `actions` são mergeados sozinhos por `dependabot-auto-merge.yml` quando o PR fica verde, que em seguida dispara o `main.yml` (merge feito com `GITHUB_TOKEN` não dispara `push`). Ficam para revisão humana: o grupo `critical` (`next`, `stripe`, `@supabase/*`, `supabase`, `drizzle-*`, `pg`, `@sentry/*`, `effect`: o que o CI não prova por inteiro), `@cbrl/*`, majors e updates de segurança.

## Regras de migration

- **Gerar, nunca escrever à mão o diff de schema**: `pnpm --filter @oilio/web db:generate` (event store) / `pnpm --filter @oilio/product db:generate`. SQL fora do Drizzle (roles, grants, RLS) via `drizzle-kit generate --custom`.
- **Imutáveis depois do merge.** Errou? Nova migration corrigindo (fix forward). O CI bloqueia edição/rename/remoção.
- **Expand → contract.** Durante o deploy, a versão anterior do app roda contra o schema novo:
  - adicionar coluna: nullable ou com default;
  - renomear/remover coluna ou tabela: (1) PR que adiciona o novo e para de usar o antigo, (2) PR seguinte remove o antigo;
  - `NOT NULL` em coluna existente: backfill numa migration, constraint em outra.
- **Event store é append-only** (ADR 0017): nada de `UPDATE`/`DELETE` em `events`; renomear identificador persistido exige upcaster-on-read.
- **Nunca `drizzle-kit push`** em prod.
- Os dois journals ficam no schema `drizzle`: `__drizzle_migrations` (event store) e `__drizzle_migrations_product`.

## Rollback

- **App**: Vercel → Deployments → deploy anterior → _Instant Rollback_. Seguro por causa do expand → contract.
- **Schema**: não há down migration. Corrige com migration nova via PR. Em incidente com perda de dado: Supabase → Database → Backups (point-in-time depende do plano).
- **Migration falhou no CI**: o Drizzle aplica as pendentes de cada journal numa única transação, então nada fica pela metade (consequência: nada de `CREATE INDEX CONCURRENTLY`). A Vercel não promove o deploy (check vermelho). Corrigir com PR e mergear.

## Configuração (uma vez)

### Supabase

- Projeto `oilio`, região `sa-east-1`.
- Settings → API: **Data API desligada**.
- Senha do `oilio_app` (a migration 0023 cria a role `NOLOGIN`), definida uma vez no SQL editor, com senha gerada e guardada só nas envs da Vercel:
  ```sql
  ALTER ROLE oilio_app LOGIN PASSWORD '<senha forte>';
  ```
- Auth:
  - Site URL: `https://www.oilio.com.br`.
  - Redirect URLs: `https://www.oilio.com.br/**`, `https://oilio.com.br/**` e o padrão dos previews da Vercel (`https://oilio-*-cbrl-dev.vercel.app/**`).
  - Providers: Google ligado; Email (senha/magic link) desligado; sign-up anônimo desligado.
  - Google Cloud (OAuth client _Web_ de produção): origin `https://www.oilio.com.br`; redirect URI `https://<ref>.supabase.co/auth/v1/callback`.

### GitHub

- Environment `production`, restrito à branch `main`.
- Secret do environment `POSTGRES_URL_NON_POOLING`: connection string do **session pooler** (porta 5432) como `postgres` — `postgresql://postgres.<ref>:<senha>@aws-<n>-sa-east-1.pooler.supabase.com:5432/postgres`. O host direto `db.<ref>.supabase.co` é só IPv6 e os runners não alcançam; o pooler de transação (6543) não suporta o advisory lock do migrator.

### Vercel

Envs de Production (todas server-only, exceto `NEXT_PUBLIC_*`):

| Env                                                                | Valor                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | projeto Supabase                                                                                                                           |
| `NEXT_PUBLIC_SITE_URL`                                             | `https://www.oilio.com.br`                                                                                                                 |
| `OILIO_DATABASE_URL`, `DATABASE_URL`                               | **transaction pooler** (6543) como `oilio_app`: `postgresql://oilio_app.<ref>:<senha>@aws-<n>-sa-east-1.pooler.supabase.com:6543/postgres` |
| `SUPABASE_SECRET_KEY`                                              | secret key do Supabase (exclusão de conta)                                                                                                 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`     | Stripe live ([stripe-setup.md](stripe-setup.md))                                                                                           |
| `CRON_SECRET`                                                      | aleatório (≥ 32 bytes); a Vercel manda no header dos crons                                                                                 |

- **Nunca** `ENABLE_TEST_AUTH` em Production/Preview.
- Previews não recebem as envs de banco/Stripe de produção.
- Settings → Deployment Checks: exigir o check `Deploy (migrate database)` antes de promover pra produção.
- Deployment Protection (Vercel Authentication) só em Preview; o domínio de produção é público.

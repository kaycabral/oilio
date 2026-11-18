# ADR 0020 — Produção em Supabase (Postgres + Auth) e Vercel; sai GCP/Firebase

- **Status**: accepted
- **Date**: 2026-11-18
- **Deciders**: kaycabral
- **Related ADRs**: [0017-oilio-em-producao](0017-oilio-em-producao.md) (estado do ambiente — atualizado nesta data) · [0011-postgres-monorepo-pattern](0011-postgres-monorepo-pattern.md) (D2/D3: migration fora do boot, nunca `push`) · [0010](0010-event-sourcing-seletivo.md)/[0012](0012-relational-event-store-persistence-port.md) (event store imutável)

## Context

O oilio rodava em GCP: Cloud Run + Cloud SQL (`oilio-db`, IAM auth via connector, IP privado) + Firebase Auth. O ambiente foi desligado em 2026-08-07 com dump completo dos bancos (`shutdown-dump-{oilio,produtos,postgres}.sql.gz`). O front voltou na Vercel sem backend. Para religar com custo e operação mínimos, o mesmo padrão já validado no imovil: Supabase (Postgres + Auth) + Vercel + GitHub Actions.

## Decision

1. **Postgres no Supabase** (`sa-east-1`), um banco só: event store + projeções e a base de produtos (`@oilio/product`) no mesmo `postgres`, cada um com seu journal de migration (`drizzle.__drizzle_migrations` e `drizzle.__drizzle_migrations_product`). As envs `OILIO_DATABASE_URL`/`DATABASE_URL` continuam separadas para preservar a fronteira da base soberana.
2. **Roles**: o app conecta como `oilio_app` (só DML, `NOBYPASSRLS`, pelo transaction pooler) — mesmo modelo do Cloud SQL (app ≠ dono). Migrations rodam como `postgres` só pelo CI. A migration 0023 cria a role e zera os privilégios de `anon`/`authenticated`/`service_role` em `public`; a Data API fica desligada.
3. **TLS verificado**: `@cbrl/pg` com `supabaseSsl` (CA raiz do Supabase pinada, `verify-full`). Sai a estratégia IAM e o `@google-cloud/cloud-sql-connector`.
4. **Auth no Supabase** (Google via OAuth PKCE, `@supabase/ssr`). O servidor confia só em `getClaims()` (assinatura verificada). Sai Firebase Auth, session cookie próprio e `/api/session`.
5. **Identidade preservada sem reescrever o event store**: `users.uid` continua sendo a identidade do app. Conta nova usa o id do Supabase; conta migrada carrega o uid do Firebase em `app_metadata.oilio_uid` (só service role escreve; vai assinado no JWT). Os usuários legados foram pré-criados no Supabase Auth pelo email verificado do Google; no primeiro login o Supabase vincula a identidade Google pelo email verificado.
6. **LGPD**: a exclusão de conta também apaga o usuário do Supabase Auth (identidade + refresh tokens), e um login nunca re-hidrata PII de conta anonimizada.
7. **Crons** na Vercel (`Authorization: Bearer $CRON_SECRET`, comparação em tempo constante).
8. **Restauração**: schema recriado pelas migrations do repo (as 23 aplicadas em prod; as diferenças de hash em 0007/0019 são só comentários, verificado no git) e dados restaurados do dump numa transação, em ordem de FK, com contagem conferida tabela a tabela.

## Consequences

- **Positivo**: sem GCP para operar; dev/E2E no mesmo stack de prod (Supabase local), com o app sob teste como `oilio_app` — o RLS agora vale também no E2E; deploy gated por migration no CI.
- **Custo**: login local por email/senha só no stack local (`ENABLE_TEST_AUTH`); produção só Google.
- **Aberto**: hourly notifications exige Vercel Pro (Hobby só agenda cron diário) — o módulo está atrás de flag desligada.

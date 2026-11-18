# ADR 0017 — oilio está em produção (fonte única) + regra anti-premissa-stale

- **Status**: accepted
- **Date**: 2026-07-08
- **Deciders**: kaycabral
- **Issue**: [#1383 — Auditar e corrigir informação stale (pré-prod/re-seed)](https://gitlab.com/cbrl/cbrl/-/issues/1383)
- **Related ADRs**: [0008-event-sourcing-ddd-effect](0008-event-sourcing-ddd-effect.md) (a premissa "big bang sem dado de prod" era verdadeira em 2026-05-27 e hoje está superada por esta ADR) · [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) e [0012-relational-event-store-persistence-port](0012-relational-event-store-persistence-port.md) (a imutabilidade do event store que esta ADR torna load-bearing) · [0013-relacionalizacao-pos-migracao](0013-relacionalizacao-pos-migracao.md) (a estratégia D6 "drop & recreate" assume janela sem dado vivo — invalidada por esta ADR)

## Context

Durante o `/implement 1380` (Razão dimensional), uma decisão de arquitetura quase foi tomada com base numa informação **factualmente errada e desatualizada** presente no código: comentários afirmando que "oilio is pre-prod with no persisted events" e que a política de evolução de schema é **re-seed, não upcaster**. A premissa é **falsa** — e o mais perigoso: ela é _load-bearing_, sustentava a decisão de **pular o upcaster/backfill** e de **reescrever a tabela `events` in-place** (violação potencial de imutabilidade).

A raiz não é um comentário isolado, e sim a **ausência de uma fonte única de verdade** sobre o estado do ambiente. A premissa "pré-prod" foi verdadeira num passado recente (o cutover Postgres #1202, a migração big-bang do ADR 0008), envelheceu quando o app entrou em produção, e ficou espalhada em comentários, ADRs e migrations — cada um envelhecendo silenciosamente, sem data nem mecanismo de invalidação.

## Decision

### 1. oilio está em PRODUÇÃO — esta ADR é a fonte única

**oilio está em produção desde ~2026-07-02** (primeiro evento persistido no event store de produção: `2026-07-02T11:35Z`). Evidência (auditoria #1383, verificada 2026-07-08):

- Projeto GCP de produção: `cbrl-oilio-production` (Firebase Auth + Cloud Run).
- Domínio no ar: `oilio.com.br`.
- Deploy real: `gcloud run deploy oilio` disparado por tag `oilio-v*` — 18+ releases (`oilio-v0.18.4`).
- Banco de produção: Cloud SQL `oilio-db` (POSTGRES_17, `us-east4`, private-IP-only), banco lógico `oilio`, com a tabela `events` **migrada a cada deploy** pelo Cloud Run Job `oilio-migrate-event-store`.
- Estado do event store em 2026-07-08: `8` eventos persistidos, tipos `org_billing`/`org`/`order`/`membership`/`unit`.

**Nenhum outro comentário, doc, ADR ou memória deve reafirmar o estado do ambiente por conta própria.** Onde uma decisão depender de "oilio está/não está em produção", ela referencia esta ADR — não reinventa a premissa. Se o estado mudar (nunca deve regredir), esta ADR é o único ponto a atualizar.

### 2. Consequência de imutabilidade (torna outras ADRs load-bearing)

Com dado vivo em produção, o event store (`events`) é **append-only e imutável de fato**, não só por convenção:

- **Proibido reescrever `events` in-place.** Renomear identificadores persistidos (`aggregate_type`, `_tag`, campos de payload) num stream **não-vazio** exige **upcaster-on-read** (ADR 0010/0012), nunca `UPDATE`/`DELETE` destrutivo. A migration `0007_rename_member_operations.sql` fez `UPDATE events` — foi inócuo apenas porque o stream de prod estava vazio na data (#1383); **não é padrão a repetir**.
- **Proibido drop & recreate do banco de prod.** A estratégia D6 do ADR 0013 ("recriar banco limpo / squash de migrations") assume "janela sem dado vivo" — **essa janela fechou**. Qualquer squash/recreate agora destrói o event log de produção.
- **Bump de `schemaVersion` sem upcaster corrompe replay** quando há eventos históricos do aggregate: `Effect` decoda com `onExcessProperty='ignore'`, então o replay dropa silenciosamente o campo renomeado.

### 3. Regra anti-premissa-stale (o mecanismo)

Regras processuais para não sermos enganados de novo por informação declarativa desatualizada:

1. **Afirmação factual sobre ambiente carrega data + método de verificação.** Todo comentário/doc que afirma um fato sobre prod/banco/infra ("prod está vazia", "sem dado a migrar", "instância X existe") deve trazer `verified <DATA> via <como>`. Sem isso, a afirmação é suspeita por construção — não load-bearing.
2. **Antes de confiar em ADR/comentário/memória para uma decisão _load-bearing_, verificar a realidade** (banco / GCP / CI), não a documentação. A doc informa onde olhar; a realidade decide. (Padrão já registrado nas memórias do agente; esta ADR o eleva a regra de produto.)
3. **Verdade histórica datada não se apaga — anota-se a superação.** Uma premissa que era verdadeira numa data (ex.: ADR 0008 em 2026-05-27) permanece no registro como contexto histórico, com nota explícita de que está superada e ponteiro para esta ADR. Nunca reusar a premissa antiga como licença para uma ação nova.

## Consequences

- **Positivo:** uma única fonte de verdade sobre o estado do ambiente; premissas stale deixam de se propagar silenciosamente; decisões de imutabilidade (upcaster vs. rewrite, D6) ganham âncora canônica; a regra `verified <DATA>` torna afirmações factuais auto-datadas.
- **Custo:** comentários factuais sobre infra ficam mais verbosos (data + método). Aceito — o custo de uma premissa stale load-bearing (quase corrompeu o Razão; quase reescreveu event log de prod) é ordens de magnitude maior.
- **Aberto:** a auditoria #1383 corrigiu os pontos mapeados (comentários das migrations 0007/0019, config de `member_operation`, ADR 0008, seed reset); a estratégia D6 do ADR 0013 continua marcada como premissa a invalidar quando/se o épico for retomado.

## Atualização 2026-11-18 — ambiente migrado para Supabase + Vercel

A evidência da seção 1 (GCP `cbrl-oilio-production`, Cloud Run, Cloud SQL `oilio-db`) é **histórica**: o ambiente GCP foi desligado em 2026-08-07, com dump completo dos bancos. A decisão de plataforma está no [ADR 0020](0020-supabase-vercel.md); o runbook, em [`docs/production.md`](../production.md). A seção 2 (event store imutável) continua valendo integralmente.

Estado atual (verified 2026-11-18 via queries no banco de produção como `postgres` e como `oilio_app`, Supabase CLI e API da Vercel):

- Postgres + Auth: Supabase, projeto `oilio` (`sa-east-1`). Schema aplicado pelas migrations do repo (journal `drizzle.__drizzle_migrations` com 24 entradas, `__drizzle_migrations_product` com 2).
- Dados: restaurados do dump de 2026-08-07, com contagem conferida tabela a tabela (`orgs`=4, `users`=11, `events`=77, `memberships`=9, `org_billing`=2, `subscriptions`=2). O `events` foi restaurado byte a byte, sem reescrita.
- Identidade: os 11 usuários legados existem no Supabase Auth com o uid do Firebase em `app_metadata.oilio_uid`.
- App: Vercel, projeto `oilio`, `www.oilio.com.br`, região `gru1`; o runtime conecta como `oilio_app` (sem `BYPASSRLS`).

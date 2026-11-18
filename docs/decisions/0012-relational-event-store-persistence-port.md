# ADR 0012 — Event store relacional + PersistencePort (fundação da migração oilio→Postgres)

- **Status**: accepted
- **Date**: 2026-06-21
- **Deciders**: kaycabral
- **Brief**: [`0057-migracao-postgres-fundacao`](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0057-migracao-postgres-fundacao)
- **Related ADRs**: [0011-postgres-monorepo-pattern](0011-postgres-monorepo-pattern.md) (tooling Postgres reusado), [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (fronteira ES/CRUD preservada), [0008-event-sourcing-ddd-effect](0008-event-sourcing-ddd-effect.md) (event store via Effect)
- **PRD upstream**: [PRD — Migração oilio→Postgres](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Migracao-Oilio-Postgres)

## Context

A migração do oilio (Firestore → Cloud SQL Postgres) é incremental por bounded context, atrás de uma porta de abstração com feature-flag (rollback = virar a flag). A **feature A** é a fundação: monta a infra Postgres do oilio (reusando o padrão da [ADR 0011](0011-postgres-monorepo-pattern.md)) e introduz a porta neutra atrás da qual o event store roda hoje em Firestore e amanhã em Postgres — **sem migrar nenhum contexto real** (isso é a feature B). O seam já existia: `appendEvent`/`replayAggregate` (`src/domain/effect/event-store.ts`) rodavam sobre a `FirestoreService` Tag direto.

## Decision

### D1 — `PersistencePort`: a Tag neutra que o event store consome

O event store passa a rodar sobre um **`PersistencePort`** (`Context.Tag` do Effect) — não mais sobre `FirestoreService` direto. A porta expõe o mínimo que `appendEvent`/`appendEventGuarded`/`replayAggregate` precisam: leitura de stream (`getEvents`) e uma transação que escreve evento + projeção atomicamente. Dois Layers a satisfazem:

- **Firestore Layer** (atual — comportamento preservado): a implementação de hoje, intacta.
- **Postgres Layer** (novo): escreve o evento na tabela `events` e a projeção na mesma transação `pg` (ACID).

Reducers/aggregates/envelope **não mudam** — a porta troca o substrato por baixo. O envelope (`_tag`/version/timestamp/actorId/schemaVersion/payload) é o mesmo nos dois Layers, então o decode/replay é idêntico.

### D2 — Seleção de Layer por feature-flag global; default Firestore

A flag **`OILIO_PERSISTENCE`** (`firestore` | `postgres`, default `firestore` via `@oilio/env`) escolhe o Layer provido pelo `effect-bridge`. Por enquanto é global; vira por-contexto na feature B. Default Firestore = o oilio de hoje não regride (a fundação é aditiva).

### D3 — Event store relacional: `events` append-only, `UNIQUE(aggregate_id, version)`, projeção na mesma tx

A tabela `events` é append-only: `aggregate_type`, `aggregate_id`, `version`, `org_id`, `envelope` (JSONB), `created_at`. A integridade vem do **banco**, provada por integration contra Postgres real:

- `UNIQUE(aggregate_id, version)` — concorrência otimista no banco (não na app): dois appends pra mesma version, o segundo é recusado.
- `CHECK (version > 0)` — version 1-based monotônica.
- A projeção é atualizada na **MESMA transação** do evento → rollback deixa **zero** linha (nem evento, nem projeção); elimina divergência stream↔projeção por construção.

`org_id` é coluna + **índice líder** (`org_id`, `aggregate_type`, `version`) **preparado pra RLS** — mas **RLS NÃO é ligado aqui** (feature C, Onda 2). PII nunca no envelope (contrato da ADR 0010).

### D4 — O código Postgres do event store mora no app, não num package

Diferente do `@oilio/product` (package porque tem vocação de serviço cross-org), o event store é **do oilio**. Mora em `apps/web/src/shared/db/pg/` (schema, pool lazy `max:5`, migrate). Convenção local: `apps/web` é um único workspace — só promove pra `packages/@cbrl/*` com 2º consumidor (não há). Reusa o tooling da ADR 0011 (Drizzle + `pg` + `drizzle-kit`, migration em Cloud Run Job nunca no boot, `push` proibido).

### D5 — Database lógico `oilio` na instância `oilio-db`; migration em Cloud Run Job

A instância `oilio-db` hospeda **2 databases lógicos**: `produtos` (base soberana, `DATABASE_URL`) e `oilio` (event store, **`OILIO_DATABASE_URL`** dedicado). As migrations do event store rodam num **Cloud Run Job dedicado** (`oilio-migrate-event-store`, entrypoint `scripts/migrate-event-store.mjs` via `drizzle-orm` migrator) no estágio de deploy, antes do `gcloud run deploy` — nunca no boot. No CI, o Postgres efêmero (`services: postgres`) cria o database `oilio` e roda a integration do ciclo.

### D6 — Co-locação região (AC-05): `DEPLOY_REGION` == região da `oilio-db`

O oilio deploya via **Cloud Run** (`gcloud run deploy`, var `DEPLOY_REGION`) — **não App Hosting** (o brief 0057 escreveu "App Hosting" antes da migração Cloud Run consolidar). Pra evitar egress + latência cross-region, `DEPLOY_REGION` deve ser igual à região da instância `oilio-db` (`southamerica-east1`). É config de CI (var de projeto), confirmada na provisão; não está versionada no repo. Se divergir, alinhar antes de ligar o Postgres Layer em prod.

## Consequences

- **+** A feature B (migrar `catalog-item`) pluga o Postgres Layer + vira a flag **sem tocar** infra nem event store — a fundação "some" e só destrava.
- **+** Atomicidade evento+projeção elimina reconciliação stream↔projeção (a invariante ACID que o Firestore não dava).
- **+** Primeiro Postgres transacional multi-tabela do oilio — o padrão que B…E seguem.
- **−** Flag global (não por-contexto) é um meio-termo até a B; aceito como piso.
- **Provisionamento de produção** (database `oilio` + role `oilio_app` na instância `oilio-db`) é **operacional, fora do escopo do código** (igual ADR 0011 pro `produtos`) — a feature A roda inteiro em Postgres local/CI via docker. A migration Job + a env `OILIO_DATABASE_URL` ativam quando `OILIO_CLOUDSQL_INSTANCE` for provisionado e setado como var de CI.
- **Probe descartável** prova o ciclo (append→projeção→replay/atomicidade/concorrência); é removido quando a B trouxer contexto real.

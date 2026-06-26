# ADR 0011 — Padrão de Postgres do monorepo (Drizzle + pg + migration em Job)

- **Status**: accepted
- **Date**: 2026-06-19
- **Deciders**: kaycabral
- **Brief**: [`0049-base-produtos-infra-gtin`](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0049-base-produtos-infra-gtin)
- **Related ADRs**: [0004-multi-org-model](0004-multi-org-model.md) (o invariante zero-cross-org **não** se aplica à base soberana — ver D5), [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (o `Product` do **Firestore do oilio** é CRUD/snapshot; o `Product` da **base soberana** desta ADR é outra entidade, em Postgres, sem ES)
- **PRD upstream**: [PRD — Base de Produtos](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Base-de-Produtos)

## Context

A **Base de Produtos** ([brief 0049](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0049-base-produtos-infra-gtin)) é o **primeiro Postgres do monorepo**. Até aqui toda persistência era Firestore (per-app, multi-tenant). A base soberana de produtos é cross-org, com integridade que o Firestore não dá (constraints nativas: `UNIQUE`, `NOT NULL`, `CHECK`, enum, FK) — daí Postgres (Cloud SQL).

Como é o piloto, as decisões operacionais de Postgres tomadas aqui viram **o padrão do monorepo**, herdado pela [Migração oilio→Postgres](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Migracao-Oilio-Postgres). Esta ADR formaliza o que o brief 0049 fechou em pesquisa de estado da arte (jun/2026), pra que a próxima iniciativa não re-decida.

## Decision

### D1 — Tooling: Drizzle 0.45.x + node-postgres (`pg`) + `drizzle-kit`

**Drizzle ORM** (schema-as-code TS puro, sem codegen) sobre o driver **node-postgres (`pg`)**; migrations via **`drizzle-kit generate`** (SQL versionado no repo) + **`drizzle-kit migrate`** (aplicação).

Racional: schema-as-code sem etapa de codegen (vs Kysely, que exige `kysely-codegen` e arrisca drift); runtime ~7KB sem binário, cold-start serverless desprezível (vs Prisma ~85× o footprint); SQL versionado e revisável em PR (vs migrations opacas).

**Fixado em `~0.45.2` no catalog do `pnpm-workspace.yaml`.** O v1 do Drizzle (RQB-V2, casing API, folders-v3) está em RC e é breaking; o upgrade é item de roadmap com blast radius mínimo (1 tabela). Atlas (linting de mudança destrutiva) adiado — valor real é pago e over-engineering pra 1 tabela; `drizzle-kit export` dá a ponte pra adotar depois barato.

### D2 — Migration roda em Cloud Run Job dedicado, **nunca no boot**

A aplicação de migrations (`drizzle-kit migrate`) roda num **Cloud Run Job dedicado**, disparado no deploy — nunca no boot da aplicação. Com N instâncias subindo, migrar no boot gera corrida de advisory-lock (várias instâncias tentam migrar ao mesmo tempo). O Job serializa.

### D3 — `push` proibido em produção

**`drizzle-kit push` é proibido em prod.** O `push` faz diff direto schema↔banco; um rename de coluna vira **drop+add** → perde dado. Em prod só roda migration versionada (`generate` → revisão em PR → `migrate` no Job). `push` fica restrito a exploração local descartável, se tanto.

### D4 — Pool `pg` pequeno e lazy; regra de prepared-statements sob pooler

Pool `pg` pequeno (`max: 3–5`, idle 10min, **lazy** — criado no primeiro uso, não no import) pra não exaurir as conexões do Cloud SQL a partir de instâncias serverless. Quando a contagem de instâncias crescer, um **pooler** (PgBouncer / Cloud SQL) entra na frente — e aí, sob **transaction-mode pooling**, prepared statements quebram: usar **`prepare: false` / sem `name:` nas queries**.

### D5 — Expand-contract pra mudanças não-backward-compatible

Mudança de schema não-backward-compatible segue **expand-contract**: (1) expand (adiciona o novo, mantém o velho), (2) migra o consumo, (3) contract (remove o velho) — em migrations separadas, nunca num passo destrutivo único.

### D6 — Fronteira física: a base soberana é cross-org, sem `orgId`

A base mora num package isolado (`@cbrl/product`), não importa nada do multi-tenant do oilio, e a tabela `Product` **nunca carrega `orgId`** — é infra de produto, cross-org. O invariante zero-cross-org da [ADR 0004](0004-multi-org-model.md) **não se aplica** (é o oposto: a constraint torna impossível vazar org pra base compartilhada). A integridade vem das **constraints do banco**, provada por integration contra Postgres real (não mock).

## Consequences

- **+** Padrão único de Postgres pro monorepo: a Migração oilio→Postgres herda tooling, migration job, pooling e regra de prepared-statements sem re-decidir.
- **+** Integridade estrutural desde o primeiro write (GTIN inválido/duplicado/restrito recusado pelo banco, não detectado depois).
- **+** SQL versionado revisável em PR; rollback é migration reversa, não mágica de ORM.
- **−** Drizzle pré-1.0: upgrade pro v1 é breaking (mitigado por pin no catalog + blast radius de 1 tabela).
- **−** Custo de instância sempre-ligada (~US$10/mês `db-f1-micro`, mesmo ociosa) — aceito como preço da barreira de modelagem; instância compartilhada `oilio-db`, não própria (gatilho de separação documentado no PRD).
- **Provisionamento de produção** (instância `oilio-db` + database `produtos` em Cloud SQL) é **fora do escopo de A1** — A1 roda inteiro em Postgres local via docker. A instância real é provisionada quando A2 consome (PRD § Decisões fechadas: `db-f1-micro`, database `produtos`, instância compartilhada).

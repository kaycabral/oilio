# src/domain — Domain kernel

O anel mais interno do app: aggregates Event-Sourced, read-model types/schemas, value objects e regras puras. Consumido por `features/*` e `shared/*`; é a fonte da verdade do modelo.

## Regras (enforçadas por lint — `@cbrl/eslint-base` layering)

- **100% puro.** Sem React/Next, sem Firestore/admin/`server-only`, sem `@/shared/*`, sem `@/features/*`, sem `@/app/*`. Dependência só desce até aqui. A parede de layering quebra o build se violar.
- **Sem I/O.** Acesso a dado vive em `shared/db` ou em `features/*/adapters`. O domínio só calcula/decide/projeta.
- **Mutation-tested.** É onde a mutation testing paga (lógica pura, sem emulador) — ver `stryker.conf.json` (mira `src/domain/**`).

## ⚠️ Mudança de tipo → atualizar schema Postgres

Se um tipo aqui mapeia uma projeção do Postgres, qualquer mudança (campo, nullability, enum) **exige atualizar o schema Drizzle (`src/shared/db/pg/schema/`) + uma migration em `drizzle/` na mesma PR** — e a policy RLS se a coluna entra no escopo de org. Sem isso, schema e tipos divergem. As constraints (CHECK/FK/NOT NULL) são a fonte de integridade no banco — provadas por integration (`*.events.pg.integration.test.ts`), não por rules de cliente (Firestore saiu no cutover #1202).

## Promover pra package

Hoje é pasta do app (consumidor único = a web). Se um 2º workspace nascer (`worker`/`api`/functions) que precise do kernel, extrair pra `packages/oilio/shared` é mecânico — só então o package se paga.

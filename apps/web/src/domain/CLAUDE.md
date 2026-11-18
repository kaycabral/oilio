# src/domain — Domain kernel

O anel mais interno do app: aggregates Event-Sourced, read-model types/schemas, value objects e regras puras. Consumido por `features/*` e `shared/*`; é a fonte da verdade do modelo.

## Regras (enforçadas por lint — `@cbrl/eslint-config` layering)

- **100% puro.** Sem React/Next, sem I/O (DB, auth, `server-only`), sem `@/shared/*`, sem `@/features/*`, sem `@/app/*`. Dependência só desce até aqui. A parede de layering quebra o build se violar.
- **Sem I/O.** Acesso a dado vive em `shared/db` ou em `features/*/adapters`. O domínio só calcula/decide/projeta.
- **Mutation-tested.** É onde a mutation testing paga (lógica pura, sem emulador) — ver `stryker.conf.json` (mira `src/domain/**`).

## ⚠️ Mudança de tipo → atualizar schema Postgres

Se um tipo aqui mapeia uma projeção do Postgres, qualquer mudança (campo, nullability, enum) **exige atualizar o schema Drizzle (`src/shared/db/pg/schema/`) + uma migration em `drizzle/` na mesma PR** — e a policy RLS se a coluna entra no escopo de org. Sem isso, schema e tipos divergem. As constraints (CHECK/FK/NOT NULL) são a fonte de integridade no banco — provadas por integration (`*.events.pg.integration.test.ts`), não por rules de cliente (Firestore saiu no cutover #1202).

## Invariante de campo obrigatório → vive no núcleo, não na casca (#1283)

Um campo **obrigatório de negócio** não pode aceitar o zero-value (`''`, número fora de range, `[]`) só porque o `Schema` cru permite. A invariante mora no **núcleo** (schema do read-model + CHECK no banco), não só no `parse*Form` do feature — senão todo write que pula o form (seed, replay de evento legado, saga, import) injeta zero-value como dado real. O write path **decoda** o payload do evento (`appendEventToTx` → `Schema.decodeUnknownEither`), então o schema do domínio é a borda externa: rejeitar ali é fail-fast, não "barrado só no banco".

**Cadeia canônica** (tipo → domínio → CHECK → seed → teste), por classe de invariante:

- **String obrigatória** (id/label/nome): `Schema.String` → `NonEmptyString` (em `@/domain/value-objects`) + `check('<t>_<c>_nonempty', char_length(btrim(col)) > 0)` na coluna escalar. Campo em JSONB livre: defesa só no domínio (sem CHECK viável). Campo em JSONB com discriminante: CHECK condicional (template `catalog_items_kind_shape`).
- **Valor monetário / contador** (`*Cents`, quantidades): `Schema.Number` → `MoneySchema` (int + nonNegative + brand `Money`) ou `Schema.Number.pipe(Schema.int(), Schema.nonNegative())`, espelhando o `check(>= 0 / > 0)` que o banco já tem.
- **Zero-value legítimo no INITIAL state** (caso `Address`): manter o zero-value só na memória do reducer (pré-`*.created`); o schema do **evento** carrega a invariante, não o tipo base. Predicado `is<X>Complete` quando há lógica de "completo".

**Não brandar por constraint.** `NonEmptyString` NÃO é branded: "não-vazio" é constraint, não semântica — o decode + CHECK já fecham a borda. Brand só para value object com semântica própria (`Money` = centavos não-negativos; `OrgId` = identidade). E **id de referência com FK** já é barrado contra `''` pelo banco (FK só aceita valor existente) — não adicionar CHECK nonempty redundante; a defesa nova só vale para ids/snapshots **sem FK** (uids globais).

## Promover pra package

Hoje é pasta do app (consumidor único = a web). Se um 2º workspace nascer (`worker`/`api`/functions) que precise do kernel, extrair pra `packages/oilio/shared` é mecânico — só então o package se paga.

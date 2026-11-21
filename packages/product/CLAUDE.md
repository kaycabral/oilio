# `@oilio/product` — base soberana de produtos (primeiro Postgres do monorepo)

Bounded context isolado da **base soberana de `Product`** (cross-org, identificada por GTIN). Fronteira física: **não importa nada do multi-tenant do oilio** (sem `orgId`). Vocação de virar serviço independente. Deriva do [PRD — Base de Produtos] / brief 0049.

## Escopo

- **`src/gtin/`** — validador GTIN puro (sem I/O): check-digit GS1, normalize-to-14, rejeição de prefixos restritos (RCN/coupon), ISBN-13→EAN-13, fallback `brand+MPN`. Unit-testável isolado.
- **`src/schema/`** — schema Drizzle da tabela `Product` + enum `source`. Sem `orgId`.
- **`src/db/`** — pool + Drizzle + migrations via `createDrizzleDatabase` (`@cbrl/pg/drizzle`; lazy, conexão via `DATABASE_URL`, fail-fast, journal próprio).
- **`src/port/`** — interface do Port de fonte de dados (desenho, sem adapter externo — A2 pluga).

## Regras locais

1. **Sem `orgId`, jamais.** A base é cross-org; o invariante zero-cross-org do ADR 0004 do oilio **não se aplica** (é o contrário: a constraint torna impossível vazar org pra base). Decisão de soberania/LGPD do PRD.
2. **`Product` ≠ `CatalogItem`.** Aqui mora só o intrínseco ao produto (descrição/foto/marca/medidas/NCM/CEST/uTrib). Preço/estoque/fiscal-do-vendedor ficam no `CatalogItem` (oilio). Nada de nome de um domínio operando sobre o outro: `product.*` aqui, `catalog_item.*` lá.
3. **`gtin` ≠ `sku`.** `gtin` é a chave canônica validada (GTIN-14); `sku` é identificador interno livre do `CatalogItem`. Não mapear um no outro.
4. **Constraints são do banco, não da aplicação.** A integridade (UNIQUE no GTIN-14, NOT NULL, enum) vem do Postgres — provada por integration contra banco real, nunca mock.
5. **1 GTIN = 1 produto**, normalizado a GTIN-14. Sem agrupamento heurístico (futuro).
6. **Migrations versionadas.** `drizzle-kit generate` → SQL no repo (revisável em PR). **Nunca `drizzle-kit push` em prod** (rename vira drop+add → perde dado); migration de prod roda só no job `deploy` do CI (journal próprio `drizzle.__drizzle_migrations_product`, porque divide o banco Supabase com o event store), nunca no boot. Mudança não-backward-compatible = expand-contract. Ver ADR `docs/decisions/`.

## Teste

- **unit** (`pnpm test`, env node) — só `src/**/*.test.ts` (validador puro). Floor 100% (package pequeno e puro).
- **integration** (`pnpm test:integration`, env node) — `src/**/*.integration.test.ts` contra Postgres real via `DATABASE_URL`. Sobe pelo Postgres efêmero do docker (`docker/postgres.compose.yaml`, via `scripts/product-it.mjs`), local e no CI. `fileParallelism: false` (db compartilhado).

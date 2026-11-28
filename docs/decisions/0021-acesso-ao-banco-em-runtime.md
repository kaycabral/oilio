# ADR 0021 — Acesso ao banco em runtime: privilégio mínimo e a única exceção

- **Status**: accepted
- **Date**: 2026-11-28
- **Deciders**: kaycabral
- **Related ADRs**: [0020-supabase-vercel](0020-supabase-vercel.md) (roles `oilio_app` × `postgres`) · [0012](0012-relational-event-store-persistence-port.md) (event store imutável)

## Context

O dono das tabelas (`postgres`) passa por cima do RLS. Se algum caminho de runtime conectar com ele, uma injeção de SQL ou uma query com bug enxerga e altera o banco inteiro (#80). O ADR 0020 já definiu `oilio_app` para o app; faltava fechar o que sobrou e provar em teste.

## Decision

| Caminho                                       | Credencial                                 | Sujeito ao RLS                    |
| --------------------------------------------- | ------------------------------------------ | --------------------------------- |
| Server (event store, projeções, rotas, crons) | `OILIO_DATABASE_URL` como `oilio_app`      | sim (`FORCE`, `NOBYPASSRLS`)      |
| Base de produtos (`@oilio/product`)           | `DATABASE_URL` como `oilio_app`            | só DML na tabela `product`        |
| Migrations                                    | `postgres`, só no CI                       | não (dono)                        |
| Exclusão de conta (LGPD) no Supabase Auth     | `SUPABASE_SECRET_KEY` via `deleteAuthUser` | não se aplica (API admin do Auth) |

1. **Eventos são só de acréscimo para o app**: `oilio_app` perde `UPDATE`, `DELETE` e `TRUNCATE` em `events`, `pii_events` e `product_events` (migration 0024). O apagamento por LGPD remove os sidecars de PII, nunca eventos.
2. **Base de produtos**: a role recebe só DML em `product` (product 0002), criada de forma idempotente quando o journal cai num banco próprio.
3. **`CREATE` em `public`** fica só com o dono.
4. **A suíte de integração roda como `oilio_app`**; um pool de dono existe só para fixtures. Testes provam que a role não lê outra org, não reescreve eventos e não cria objetos.
5. **Chave secreta do Supabase**: usada em um único ponto, `src/shared/auth/admin.ts` (`deleteAuthUser`), chamado só pela exclusão de conta. Não há alternativa sem a API admin do Auth. Qualquer novo uso exige atualizar este ADR.

## Consequences

- **Positivo**: nenhum caminho de runtime conecta como dono; a trilha de eventos não pode ser editada nem apagada pelo app.
- **Custo**: correções de dados em eventos só por migration, como dono.
- **Verificação em produção**: `select usename, count(*) from pg_stat_activity where datname = 'postgres' group by 1` mostra o app só como `oilio_app`.

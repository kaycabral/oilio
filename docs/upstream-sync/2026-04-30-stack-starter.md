# 2026-04-30 — sync com `cbrl-dev/stack-starter`

**Ponto de fork**: commit upstream `7888beb` (PR #31, 2026-04-27).
**HEAD upstream avaliado**: `be40478` (PR #39, 2026-04-30).
**Issue de discussão**: [#15](https://github.com/cbrl-dev/scheduling/issues/15) — resolvida em favor da migração pra Firebase.

## PRs upstream desde o fork

| Upstream PR                                                                    | Commit    | Tipo        | Decisão                                                    |
| ------------------------------------------------------------------------------ | --------- | ----------- | ---------------------------------------------------------- |
| #34 — `feat: migrate from Supabase to Firebase`                                | `6d534c4` | Arquitetura | ✅ Trazido (com namespace `@oilio/*`)                      |
| #37 — `feat: add /infra Pulumi stack provisioning Firebase + Vercel free-tier` | `0fe4952` | Infra       | ✅ Trazido (com Pulumi project renomeado pra `scheduling`) |
| #38 — `feat(roadmap): scaffold git-native milestone planning`                  | `687865a` | Docs        | ❌ Ignorar (revertido upstream por #39)                    |
| #39 — `revert: remove git-native roadmap scaffold`                             | `be40478` | Revert      | ❌ Sem ação                                                |

## Resoluções de conflito aplicadas no cherry-pick

- **Namespace**: `@scaffold/*` → `@oilio/*` em todos os arquivos novos (`apps/web/src/lib/firebase/admin.ts`, `apps/web/src/app/api/session/route.ts`, `infra/package.json`, etc).
- **CLAUDE.md (root + apps/web + packages/db)**: preservado o estilo enxuto da PR #3 (regras numeradas com links pra fontes únicas), substituindo o conteúdo do bloco "Supabase" pelo equivalente Firebase. Adicionada referência ao Pulumi `/infra` na seção Deploy.
- **README.md**: mantida a intro do `scheduling` ("Barbershop subscription scheduling system... codename `scheduling`") em vez do pitch genérico do template upstream. Quick start ajustado pra `git clone` direto (não `gh repo create --template`).
- **Docs (`architecture.md`, `env-setup.md`)**: já vinham com conteúdo Firebase upstream; só ajuste de namespace.
- **`infra/Pulumi.yaml`** e `infra/index.ts`: nome do projeto Pulumi `stack-starter` → `scheduling`; `projectDisplayName` default `Stack Starter` → `Scheduling`.
- **`package-lock.json`**: regenerado do zero (`npm install`) em vez de tentar merge das duas árvores.

## Detalhes

### #34 — Migração Supabase → Firebase

~3.500 linhas, 50 arquivos. Auth via Firebase Auth (email link + Google) com cookie httpOnly assinado pelo `firebase-admin`; Firestore substitui Postgres; `firestore.rules` + `firestore.indexes.json` substituem `supabase/migrations`; `packages/db` reescrito como singleton `firebase-admin`; `apps/web/src/lib/firebase/*` substitui `apps/web/src/lib/supabase/*`; `proxy.ts` removido; `npm run db:start` agora roda Firebase Emulator Suite. ADR upstream em `docs/decisions/0002-firebase-over-supabase.md`.

### #37 — Pulumi `/infra`

Adiciona workspace `infra/` em Pulumi TypeScript que provisiona projeto Firebase + projeto Vercel + variáveis de ambiente. Consome `@cbrl-dev/pulumi-components` (do repo `cbrl-dev/platform`).

### #38 / #39 — Roadmap git-native

Scaffold de planejamento por milestones via arquivos versionados + workflow de sync. Revertido upstream no mesmo dia. Sem ação.

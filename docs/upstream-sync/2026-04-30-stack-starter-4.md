# 2026-04-30 (4) — sync com `cbrl-dev/stack-starter`

**Ponto anterior**: `1171568` (coberto em [`2026-04-30-stack-starter-3.md`](./2026-04-30-stack-starter-3.md) + sync local em [#20](https://github.com/cbrl-dev/scheduling/pull/20)).
**HEAD upstream avaliado**: `556dfb8`.

## Motivação

Última peça do roadmap das 4 issues abertas em 2026-04-30: trazer o componente `FirebaseAppHostingBackend` ([platform#11](https://github.com/cbrl-dev/platform/issues/11) → [platform#13](https://github.com/cbrl-dev/platform/pull/13)) consumido em [stack-starter#46](https://github.com/cbrl-dev/stack-starter/pull/46). Junto, smart defaults de [platform#14](https://github.com/cbrl-dev/platform/pull/14) deixam o `infra/index.ts` mais enxuto.

`firebase init apphosting` deixa de existir no fluxo. Sobra como manual só a criação do Developer Connect git repository link (OAuth interativo do GitHub).

## PRs upstream desde o sync anterior

| Upstream PR                                                                             | Commit    | Tipo  | Decisão    |
| --------------------------------------------------------------------------------------- | --------- | ----- | ---------- |
| #46 — `feat(infra): consume FirebaseAppHostingBackend, retire firebase init apphosting` | `556dfb8` | Infra | ✅ Trazido |

## Resoluções de conflito

- `infra/index.ts`: removida a linha local `const projectDisplayName = cfg.get('projectDisplayName') ?? 'Scheduling'` — o `FirebaseWebApp` agora default a `pulumi.getProject()` (que aqui retorna `scheduling`) via platform#14, então a linha era redundante.

## Estado de produção em `scheduling-3941` e plano de reconciliação

O backend `scheduling` já existe (criado via `firebase init apphosting` durante a primeira tentativa de deploy). `firebase apphosting:backends:list` mostra "Repository" vazio — nenhum rollout aconteceu, ou seja, deletar é seguro. Plano:

1. **Criar Developer Connect git repository link** (manual, OAuth GitHub):
   - Console: https://console.cloud.google.com/developer-connect → Connect repositories → GitHub → `cbrl-dev/scheduling`
   - Ou: `firebase apphosting:repos:create`
   - Anotar o resource name (`projects/.../gitRepositoryLinks/<id>`).
2. **Deletar o backend existente** (sem rollout, seguro):
   ```bash
   firebase apphosting:backends:delete scheduling
   ```
3. **Setar o config Pulumi**:
   ```bash
   pulumi -C infra config set codebaseRepository <gitRepositoryLink-resource-name>
   ```
4. **`pulumi up`** — `FirebaseAppHostingBackend` materializa o backend referenciando o link.
5. **`npm run infra:render`** — popula `apphosting.yaml`. (Já populado nos campos NEXT*PUBLIC*\*; pode pular se nada mudou.)

## Out of scope

Nenhum. Esta PR fecha o roadmap das 4 issues de 2026-04-30. Próximas mudanças virão de novos requisitos, não de débito conhecido.

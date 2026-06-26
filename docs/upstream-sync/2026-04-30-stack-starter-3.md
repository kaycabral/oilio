# 2026-04-30 (3) — sync com `cbrl-dev/stack-starter`

**Ponto anterior**: `f5d5ad3` (coberto em [`2026-04-30-stack-starter-app-hosting.md`](./2026-04-30-stack-starter-app-hosting.md) + sync local em [#19](https://github.com/cbrl-dev/scheduling/pull/19)).
**HEAD upstream avaliado**: `1171568`.

## Motivação

Concluir o trabalho das issues abertas no roadmap do template:

- [stack-starter#43](https://github.com/cbrl-dev/stack-starter/issues/43) — bootstrap script (`npm run bootstrap`) que prima gcloud ADC + Pulumi config.
- [platform#9](https://github.com/cbrl-dev/platform/issues/9) + [platform#10](https://github.com/cbrl-dev/platform/issues/10) — componentes `FirebaseAppHostingSecret` + IAM grants automáticos no `FirebaseAppHosting` (resolvidos em [platform#12](https://github.com/cbrl-dev/platform/pull/12)).

Após [stack-starter#45](https://github.com/cbrl-dev/stack-starter/pull/45), o template consome esses componentes e o checklist manual encolhe.

## PRs upstream desde o sync anterior

| Upstream PR                                                              | Commit    | Tipo  | Decisão    |
| ------------------------------------------------------------------------ | --------- | ----- | ---------- |
| #44 — `feat: bootstrap script for first-time gcloud ADC + Pulumi config` | `59772fc` | UX    | ✅ Trazido |
| #45 — `feat(infra): consume FirebaseAppHostingSecret + IAM grants`       | `1171568` | Infra | ✅ Trazido |

## Resoluções de conflito

Auto-merge limpo nos dois commits. Nada manual.

## Estado de produção em `scheduling-3941`

Antes do sync já tínhamos rodado parte do fluxo manualmente:

- ✅ Secret `NEXT_PUBLIC_FIREBASE_API_KEY` criado via `firebase apphosting:secrets:set` (existe em Secret Manager).
- ❌ IAM binding `roles/datastore.user` para o compute SA — **nunca foi rodado** (a recomendação do agente ficou na lista "manual" mas não foi executada).

Agora o `infra/index.ts` declara ambos via Pulumi. Próximos passos pra estado convergir:

1. **`pulumi import`** o secret existente (senão `pulumi up` falha tentando criar duplicado):

   ```bash
   cd infra
   pulumi import gcp:secretmanager/secret:Secret api-key projects/scheduling-3941/secrets/NEXT_PUBLIC_FIREBASE_API_KEY
   ```

   Pulumi vai sugerir o trecho de código a adicionar — comparar com o que o componente já declara e ajustar se preciso.

2. **`pulumi up`** — cria a `SecretVersion` (com o valor do `webApp.config.apiKey`) e o `IAMMember` `roles/datastore.user`. Se o secret e versão já existirem com o mesmo conteúdo, Pulumi adota sem replace.

3. **`gcloud secrets versions list NEXT_PUBLIC_FIREBASE_API_KEY --project=scheduling-3941`** pra confirmar a versão ativa.

## Out of scope

- Criação do backend de App Hosting via IaC ([platform#11](https://github.com/cbrl-dev/platform/issues/11)) — `firebase init apphosting` continua sendo manual.

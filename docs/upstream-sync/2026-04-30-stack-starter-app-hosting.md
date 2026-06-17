# 2026-04-30 — sync com `cbrl-dev/stack-starter` (Vercel → App Hosting)

**Ponto anterior**: `be40478` (coberto em [`2026-04-30-stack-starter.md`](./2026-04-30-stack-starter.md)).
**HEAD upstream avaliado**: `3cb8777` (PR #41, 2026-04-30).

## Motivação

Vercel Hobby (free) não cobre repos de organização — `cbrl-dev/scheduling` é repo de org, então o pipeline preview-by-PR só funcionaria no Pro (pago). Upstream optou por ir single-cloud em GCP via Firebase App Hosting (Cloud Run + Cloud Build gerenciados pelo Firebase). Aplicamos a mesma decisão aqui.

## PRs upstream desde o fork

| Upstream PR                                                            | Commit    | Tipo        | Decisão                                                   |
| ---------------------------------------------------------------------- | --------- | ----------- | --------------------------------------------------------- |
| #40 — `feat: switch deploy target from Vercel to Firebase App Hosting` | `4ffd7b7` | Arquitetura | ✅ Trazido (com namespace `@oilio/*`)                     |
| #41 — `refactor(infra): consume FirebaseAppHosting component`          | `3cb8777` | Infra       | ✅ Trazido (depende de `cbrl-dev/platform#7`, já em main) |

## Resoluções de conflito aplicadas

- **`CLAUDE.md`** (seção Deploy): preservado o estilo enxuto (parágrafo único com links pra fontes), substituindo o conteúdo Vercel pelo equivalente App Hosting + Blaze.
- **`README.md`**: mantida a intro do `scheduling` ("Barbershop subscription scheduling system... codename `scheduling`"), trocando "free tier ready (Vercel + Firebase)" por "single-cloud GCP via Firebase App Hosting + Firestore + Auth, **Blaze plan** required".
- **`docs/env-setup.md`** (tabela de envs): manteve referências `@oilio/db` em vez de aceitar o `@scaffold/db` que veio upstream.
- **`infra/README.md`** (Prerequisites): consolidado — substituído "Vercel API token" por "Firebase CLI", e o link upstream `stack-starter#36` mantido como "tracked upstream in".
- **`infra/index.ts`**: aceito o lado upstream completo (App Hosting APIs em #40, depois substituído pelo componente `FirebaseAppHosting` em #41).
- **Pulumi.dev.yaml local** (com `scheduling-3941` configurado): preservado em stash; será reaplicado depois do merge.

## Mudanças importantes pro fluxo de deploy

- **Blaze obrigatório** no projeto GCP — App Hosting não roda no Spark.
- **`firebase init apphosting`** vira passo manual one-time (cria backend + conecta GitHub via OAuth interativo).
- **Secrets**: agora via `firebase apphosting:secrets:set <NAME>` (cria Secret Manager + IAM grant numa só chamada), não mais via env vars de Vercel.
- **`apps/web/apphosting.yaml`**: novo arquivo de build/runtime config, populado por `npm run infra:render` a partir dos outputs do Pulumi.
- **`vercel.json` removido**.

## Out of scope

- O componente `FirebaseAppHosting` em `@cbrl-dev/pulumi-components` (`platform#7`) não cria o backend de App Hosting nem a conexão GitHub — só liga as 6 APIs necessárias. Backend + repo continuam sendo setup via `firebase init apphosting`. Automatizar isso em IaC depende de OAuth interativo do Cloud Build e fica como follow-up.

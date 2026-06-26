# Upstream sync log

O `scheduling` foi forkeado do template [`cbrl-dev/stack-starter`](https://github.com/cbrl-dev/stack-starter). Esta pasta registra mudanças relevantes que aconteceram upstream depois do fork e a decisão tomada sobre cada uma (trazer, adaptar ou ignorar).

## Índice

| Arquivo                                                                                | Janela upstream    | Tema                                                                       |
| -------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| [`2026-04-30-stack-starter.md`](./2026-04-30-stack-starter.md)                         | `7888beb..be40478` | Migração Supabase → Firebase + Pulumi `/infra` inicial                     |
| [`2026-04-30-stack-starter-app-hosting.md`](./2026-04-30-stack-starter-app-hosting.md) | `..3cb8777`        | Vercel → Firebase App Hosting; consumo de `FirebaseAppHosting` component   |
| [`2026-04-30-stack-starter-3.md`](./2026-04-30-stack-starter-3.md)                     | `..1171568`        | Bootstrap script; `FirebaseAppHostingSecret` + IAM grants                  |
| [`2026-04-30-stack-starter-4.md`](./2026-04-30-stack-starter-4.md)                     | `..556dfb8`        | `FirebaseAppHostingBackend` component; aposenta `firebase init apphosting` |
| [`2026-04-30-validation.md`](./2026-04-30-validation.md)                               | —                  | Pass de validação fresh-project; achados que viraram fixes em ambos repos  |

A partir de 2026-04-30, fricções descobertas pela validação geraram fixes diretos em `cbrl-dev/stack-starter` e `cbrl-dev/platform` em vez de viver em `scheduling` — o template absorveu o aprendizado. Detalhes no doc de validação.

## Como atualizar

1. Identifique o último commit upstream conhecido (ver tabela acima — última entrada).
2. `git log --oneline <último-conhecido>..upstream/main` no `stack-starter`.
3. Crie `YYYY-MM-DD-stack-starter[-suffix].md` listando cada PR e a decisão.
4. Adicione a entrada no índice acima.
5. Para mudanças que precisam discussão, abra issue com label `infra` no scheduling.

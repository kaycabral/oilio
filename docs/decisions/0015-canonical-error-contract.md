# ADR 0015 — Contrato de erro canônico (mensagem genérica ao cliente, detalhe no log)

- **Status**: accepted
- **Date**: 2026-07-03
- **Deciders**: kaycabral
- **Briefs**: [0083 — Contrato de erro canônico](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0083-contrato-de-erro-canonico) (materializa esta ADR — Onda 1·A)
- **PRD upstream**: [Hardening de Information Disclosure](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Hardening-Information-Disclosure) (esta ADR é a fundação da Onda 1·A; a Onda 2·B aplica o contrato nos call-sites, a Onda 3·C adiciona o log estruturado)
- **Related ADRs**: [0012-relational-event-store-persistence-port](0012-relational-event-store-persistence-port.md) (o `PersistencePort`/layer é quem lança o defect de DB que este contrato classifica) · [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (fronteira ES: os erros tipados `EventValidationError`/`GuardRejectedError` nascem no append) · [0014-authorization-by-capability](0014-authorization-by-capability.md) (fronteira ortogonal — ver seção 4)

## Context

Durante a fatia de unicidade global de WhatsApp (brief 0077 / #1273 / #1276) surgiram mensagens de erro voltadas ao usuário que, por serem específicas, viram vetor de **information disclosure** (CWE-209 / OWASP _Improper Error Handling_). O tratamento de erro do app estava **iniciado mas não sistematizado**:

- `catchSagaDefect` (`effect-bridge.ts`) discriminava **só** o SQLSTATE 23505 (unique → conflito retriável, #1320); 23503 (FK), 23514 (CHECK) e 42501 (RLS) caíam todos num `SAGA_INTEGRITY_ERROR` genérico não-intencional.
- O `effect-bridge` propagava `e.message` de erros **tipados** (`EventValidationError`) ao cliente, com texto como `"Invalid event '<tag>': schema validation failed"` — expondo o **nome de evento/tag interno**.
- Não havia um lugar único que decidisse "este erro vira qual mensagem segura"; a decisão vivia espalhada em helpers por-SQLSTATE (`isUniqueViolation`/`isForeignKeyViolation`) + um `else` implícito.
- Não havia ADR nem doc canônico sobre o tema — este é o primeiro.

## Decision

### 1. O contrato de erro (categorias + mensagem genérica)

Todo defect que chega ao boundary é **classificado** por `classifyError(defect) → ErrorCategory` (`shared/errors/classify.ts`), e a categoria mapeia pra **uma** mensagem genérica segura (`shared/errors/messages.ts`). Categorias:

| Categoria    | Origem                                                   | Retriável? | Mensagem (natureza)                                              |
| ------------ | -------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `conflict`   | 23505 (version clash do event store)                     | **sim**    | "conflito de concorrência, tente de novo"                        |
| `integrity`  | 23503 (FK), 23514 (CHECK), 23P01 (EXCLUDE / double-book) | não        | "restrição de integridade dos dados"                             |
| `forbidden`  | 42501 (RLS / insufficient privilege)                     | não        | "você não tem permissão" (neutra — não confirma estado da linha) |
| `validation` | `EventValidationError` / schema invalid                  | não        | "os dados enviados são inválidos"                                |
| `unknown`    | qualquer outro                                           | não        | "não foi possível concluir" (NÃO convida retry)                  |

**Invariante:** nenhuma mensagem ao cliente carrega **SQLSTATE, nome de constraint, stack, ou nome de evento/tag interno**. Só 23505 convida a retry — dizer "tente de novo" para um erro determinístico seria mentira e esconderia bug atrás de uma mensagem com cara de flake (#1320). A classificação lê o erro de DB que o layer Postgres propaga como defeito (hoje: `pgErrorOf` do `@cbrl/pg` via `shared/db/pg/pg-error.ts`; no Effect 4 o `runPromise` rejeita com o próprio erro, sem o wrapper `FiberFailure` do Effect 3 que exigia um hook `unwrap`), consumido pela classificação, por `isUniqueViolation`/`isForeignKeyViolation` e pela checagem de double-book do `commit-appointment`, que casa também o **nome** da constraint).

### 2. Regra log × usuário

**Detalhe rico no log server-side; mensagem genérica ao usuário.** O boundary loga o defect **cru** (`console.error('[commitSaga] transaction defect', defect)`) **antes** de mapear — o diagnóstico completo fica no servidor, o cliente só recebe a mensagem da categoria. Esta é a invariante do app: um erro nunca vaza detalhe técnico ao cliente, e nunca perde detalhe no log. O **log estruturado + correlation-id** que substitui o `console.error` cru é a Onda 3·C; a regra, porém, vale desde já.

### 3. Enumeração por PII: neutralizar por contexto (rationale)

O caso de disclosure mais forte é a **enumeração por PII** (WhatsApp): responder "esse número já está em uso" confirma, a partir de um dado de PII, a existência de um cadastro. A decisão (a **aplicação** é da Onda 2·B; o **porquê** mora aqui):

- **Self-signup** (`complete-profile`, ator **não-confiável**, sem OTP): mensagem **neutra** + **rate-limit**. Fecha o oracle de enumeração.
- **Balcão** (`customer-upsert`, **operador autenticado**): mantém a mensagem **acionável** ("envie um convite"). Enumerar o próprio cliente não é o vetor, e a anti-fricção do brief 0077 é preservada.

Trade-off UX × segurança: neutralizar **uniformemente** seria mais simples, mas custaria a ação legítima do balcão sem fechar vetor adicional. A verificação forte de posse (OTP) é o mitigante de raiz — fica fora desta iniciativa (depende de provider de SMS/WA, #1276).

### 4. Fronteira de confiança = origem da mensagem (não o tipo do erro)

Distinção load-bearing entre os dois erros tipados do event store:

- `GuardRejectedError` (guard REJECT) = **regra de negócio do domínio** (ex.: item "discontinued", plano esgotado). A mensagem é **curada pelo domínio**, é para o usuário, não carrega detalhe técnico → o contrato **preserva** o texto.
- `EventValidationError` / schema invalid = **falha de infra** (schema/tag interno) → mensagem **genérica** (`validation`).

A fronteira de confiança é a **origem** da mensagem — domínio (confiável) vs infra (não-confiável) — **não o tipo** do erro. Tratar os dois igual quebraria UX legítima; tratá-los pela origem fecha o vazamento sem custo de produto.

### Fronteira com o ADR 0014 (authz × disclosure)

[0014 (autorização por capability)](0014-authorization-by-capability.md) responde **"quem pode fazer"**; este contrato responde **"o que a resposta revela"**. São ortogonais: uma ação pode ser autorizada (0014) e ainda assim vazar informação na mensagem de erro (0015), ou ser negada por RLS (`forbidden` aqui) sem que isso seja um bug de RBAC. Enumeração por PII **não** é problema de authz — é de disclosure. Não confundir os dois.

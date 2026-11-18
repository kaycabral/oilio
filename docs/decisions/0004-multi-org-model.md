# ADR 0004 — Multi-org model (path-scoped)

- **Status:** Accepted
- **Date:** 2026-05-15 (V0 shipped) — formalizado em 2026-05-21
- **Decisores:** kaycabral (sócio técnico)
- **Briefs afetados:** [`08-Features-0007-fundacao-multi-org-auth`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0007-fundacao-multi-tenant-auth), [`08-Features-0001-self-booking-publico`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0001-self-booking-publico)
- **Decisão estratégica relacionada:** [`02-Estrategia-Arquitetura-Multi-Vertical § Princípio 4`](https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Arquitetura-Multi-Vertical) — este ADR materializa a parte técnica do princípio.

> **Emenda — cutover Postgres (#1202, 2026-06-24).** O **princípio** deste ADR (isolamento estrito por org, sem cross-org query, autorização em camada de aplicação) segue valendo. A **implementação** mudou: o "path-scoped" do título era Firestore (`orgs/{orgId}/...` + Security Rules). Pós-cutover, o isolamento é **column-scoped por `org_id` + Row-Level Security** no Postgres (policy por GUC no `SecurityContext`, role sem `BYPASSRLS`), e as Security Rules foram removidas — ver ADRs [`0010`](0010-event-sourcing-seletivo.md) (fronteira ES/CRUD) e [`0012`](0012-relational-event-store-persistence-port.md) (event store relacional + RLS). Onde o texto abaixo descreve coleções/subcoleções/rules, leia o mecanismo Postgres equivalente.

## Contexto

Scheduling V0 precisa servir **múltiplos orgs** (3 unidades do cliente-zero hoje; rede regional em V1; nacional em V2). Cliente-zero (Barbearia do Bairro) opera 3 barbearias sob mesmo CNPJ — mas o produto precisa funcionar igual pra orgs independentes que NÃO podem ver dado um do outro.

Três alternativas foram consideradas pra implementar isolamento:

1. **Database por org** — Firestore project separado por org (ou DB SQL separado). Total isolation, mas overhead de provisioning + custo + impossível query cross-org pra owner que opera N orgs.
2. **Collection separada por org** — `appointments_<tid>`, `services_<tid>`. Funciona mas explode número de collections (Firestore limita), inviabiliza queries por collection name dinâmico, e Firestore Rules ficam ingovernáveis.
3. **Path-scoping com top-level mínimo** — todo dado operacional sob `orgs/{orgId}/...`; só `users` e `memberships` são top-level. Owner que opera N orgs tem N memberships e alterna `currentOrgId` em `users/{uid}`.

## Decisão

**Adotamos path-scoping (opção 3).**

### Layout canônico

```
/users/{uid}                                      ← top-level (identidade)
  ├── currentOrgId: string                     ← qual org está ativo
  └── ...

/memberships/{mid}                                ← top-level (relação user↔org)
  ├── userId: string
  ├── orgId: string
  ├── role: 'owner' | 'manager' | 'receptionist' | 'professional'
  └── ...

/orgs/{orgId}/                              ← TODO dado operacional aqui
  ├── appointments/{aid}
  ├── customers/{cid}
  ├── services/{sid}
  ├── professionals/{pid}
  ├── subscriptionPlans/{spid}
  ├── subscriptions/{sid}
  ├── comandas/{cid}
  ├── cashRegisters/{crid}
  ├── notifications/{nid}                         ← brief 0018
  └── ...
```

### Defesa em profundidade — 3 camadas independentes

1. **Server Actions** parametrizam `orgId` explicitamente. Helpers obrigatórios: `requireOrgCtx`, `requireManagerCtx`, `requireOwnerCtx` (válidos no `apps/web/src/lib/auth/`).
2. **Firestore Rules** guardam o path — `match /orgs/{tid}/{document=**}` valida `request.auth.token.orgId == tid` OU membership existe.
3. **Audit log** grava **dentro** do org. Eventos importantes ficam em `orgs/{tid}/auditLog/`.

### Proibições

- ❌ **`collectionGroup('<dado operacional>')`** no código de produto — vazaria queries cross-org. Validado por ESLint rule custom (planned, vide audit-rules report 2026-05-20).
- ❌ **Top-level collection nova pra dado operacional.** Só `users` e `memberships`. Qualquer dado novo vai sob `/orgs/{tid}/`.
- ❌ **Cross-org queries no V0.** Owner que quer agregado de N orgs alterna `currentOrgId`. V2+ pode exportar pra warehouse externo (BigQuery, ClickHouse) — nunca diretamente sobre Firestore.

## Nota de esclarecimento — descoberta de dados do titular (2026-06-04, brief 0032 / #1097)

Quando o **titular** precisa descobrir **em quais estabelecimentos ele é cliente** (direito de exclusão self-service, LGPD art. 18 — `settings/privacy`), a tentação é `collectionGroup('customers')`. Isso é **proibido** por este ADR (vazaria query cross-org).

A solução **não é exceção ao banimento** — é a **generalização do próprio padrão deste ADR**: o grafo identidade↔org mora na **camada de identidade** (como `memberships` top-level). Mantemos um **índice reverso** `users/{uid}/org_links/{orgId}` — subcoleção do **próprio** doc do usuário, **só referências (zero PII)** —, populado como **passo de saga** na criação de um `customer` em qualquer org + backfill no seed. O titular lê **só a própria subcoleção** (`users/{seu-uid}/org_links`): é uma **leitura per-usuário**, **não** uma cross-org query. Nenhum dado operacional de org é lido cross-org; nenhuma coleção operacional top-level nova é criada (o índice é subcoleção da identidade, não dado operacional). Cobre **só a relação de cliente** — `membership`/profissional **não** entra no índice (não é auto-excluível; ver brief 0041).

## Consequências

### Positivas

- ✅ **LGPD-friendly por construção** — vazamento cross-org exigiria furar 3 camadas simultaneamente.
- ✅ **Onboarding novo org** não conflita com legacy data.
- ✅ **Export/migração por org** preserva contrato com cliente — cliente sai do produto, leva o dado dele.
- ✅ **Mitiga gap competitivo** — [`03-Concorrentes-Barbearia-Cashbarber`](https://github.com/cbrl-dev/cbrl/wiki/03-Concorrentes-Barbearia-Cashbarber) tem IDs sequenciais globais que vazam volume cross-org. Nosso modelo elimina por design.
- ✅ **Firestore Rules tratáveis** — 1 regra `match /orgs/{tid}/{document=**}` cobre tudo.

### Negativas / aceitas

- ⚠️ **Sem dashboard agregado pro owner que opera N orgs** (V0). Trocar contexto via `currentOrgId` exige login → switch org → ver dashboard. Aceito como trade-off de isolamento.
- ⚠️ **Cross-org conflict** — 2 orgs podem ter mesmo `customer.whatsapp`. Sem unique constraint global. Esperado e documentado em `02-Estrategia-Modelo-Identidade`.
- ⚠️ **Owner que muda de role em org diferente** — múltiplos memberships precisam estar consistentes. Risco mitigado por: 1 membership por (userId, orgId) unique.

## Alternativas consideradas

### 1. Database por org (rejeitada)

**Por que não:** custo + provisioning overhead inviável pra V0 com 3 orgs pilotos. Impossível futuro dashboard agregado pro owner. Mudança de org exigiria conexão DB diferente — complexidade extra na server action.

### 2. Collection separada por org (rejeitada)

**Por que não:**

- Firestore Rules ficariam ingovernáveis (1 regra por collection × N orgs explodiria).
- Queries por collection name dinâmico não funcionam bem em Firestore Admin SDK.
- Estrutura quebra abstrações comuns (helpers genéricos receberiam org nome de collection, gerando boilerplate).

### 3. Path-scoping (escolhida)

Razões já listadas em "Decisão" + "Consequências positivas".

## Status de aplicação

- ✅ V0 implementado em [`apps/web/src/lib/auth/`](https://github.com/cbrl-dev/cbrl/tree/main/apps/web/src/lib/auth) (helpers + middleware)
- ⛔️ ~~Firestore Rules em `apps/oilio/firestore.rules`~~ — **removidas no cutover #1202**; o isolamento é o RLS do Postgres (ver emenda no topo + ADR 0012).
- ✅ Briefs 0001 + 0007 referenciam este ADR
- 🟡 ESLint rule `no-cross-org-query` pendente — vide [audit-rules report 2026-05-20](https://github.com/cbrl-dev/cbrl/blob/main/docs/rules-audit-2026-05-20.md) (proibição #1 do roadmap)
- 🟡 ESLint rule `require-org-ctx-guard` pendente — idem

## Referências

- Estratégia: [`02-Estrategia-Arquitetura-Multi-Vertical § Princípio 4`](https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Arquitetura-Multi-Vertical) — narrativa de negócio
- Modelo de identidade: [`02-Estrategia-Modelo-Identidade`](https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Identidade)
- Brief de fundação: [`08-Features-0007-fundacao-multi-org-auth`](https://github.com/cbrl-dev/cbrl/wiki/08-Features-0007-fundacao-multi-tenant-auth)
- ESLint rules candidatas: [`docs/rules-audit-2026-05-20.md`](https://github.com/cbrl-dev/cbrl/blob/main/docs/rules-audit-2026-05-20.md)

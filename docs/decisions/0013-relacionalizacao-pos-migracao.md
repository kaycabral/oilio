# ADR 0013 — Relacionalização pós-migração (pagar a dívida do contrato Firestore preservado no Postgres)

- **Status**: proposed
- **Date**: 2026-06-25
- **Deciders**: kaycabral
- **PRD upstream**: [PRD — Migração oilio→Postgres](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Migracao-Oilio-Postgres) (🟢 concluída — esta ADR é a sequência natural: a migração trocou o motor, esta relacionaliza o modelo)
- **Briefs**: [0068 — Relacionalização do modelo](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0068-relacionalizacao-modelo-postgres) (materializa D1–D4) · [0066 — Hardening guiado por medição](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0066-hardening-schema-perf-postgres) (perf por medição — revisado quando esta ADR reverteu as refutações de FK/timestamptz)
- **Related ADRs**: [0012-relational-event-store-persistence-port](0012-relational-event-store-persistence-port.md) (o `PersistencePort` path-based que esta ADR propõe tipar), [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (fronteira ES/CRUD + snapshot-on-use + PII fora do evento — **preservados, não redecididos**), [0009-timezone-two-clocks](0009-timezone-two-clocks.md) (storage UTC — a tipagem de datas obedece), [0008-event-sourcing-ddd-effect](0008-event-sourcing-ddd-effect.md) (event store via Effect), [0004-multi-org-model](0004-multi-org-model.md) (membership vs entidades org-scoped)

## Context

A migração oilio→Postgres ([PRD](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/PRD-Migracao-Oilio-Postgres), ADR [0012](0012-relational-event-store-persistence-port.md)) trocou o **motor** (Firestore → Cloud SQL Postgres) sem **relacionalizar o modelo**. Foi a escolha certa no cutover: o `PersistencePort` preservou o contrato Firestore — **doc path como chave**, **referências por id-string sem FK**, **estado composto em JSONB** — pra mover persistência sem reabrir reducers, envelope e ~100 call-sites. Cutover primeiro, relacionaliza depois.

O custo dessa preservação agora é concreto e mensurável (auditoria de schema + uso, 2026-06-25, evidência em código citada por item abaixo). Quase toda dúvida levantada sobre a modelagem é **o mesmo resíduo**: um modelo de documento rodando num banco relacional que não usa os mecanismos relacionais (tipos temporais, FK, join tables). Esta ADR fecha o que é dívida real, o que é trade-off deliberado a manter, e a **ordem de pagamento** por risco × independência do seam — pra que cada PR futuro não re-decida do zero.

**Nota sobre reversão (2026-06-25):** uma auditoria multi-agente anterior (24/06, registrada no brief [0066](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0066-hardening-schema-perf-postgres) v1) havia marcado **FK ausente** e **TEXT vs TIMESTAMPTZ** como "refutados — não entram". Uma re-auditoria adversarial (lendo o código que as refutações citavam) reverteu ambas: a refutação de FK era **racionalização fraca** (citava o ADR [0010](0010-event-sourcing-seletivo.md) D2, que trata de _PII fora do payload de evento_ — tópico distinto de _constraint entre projeções_; e LGPD é compatível com FK via `ON DELETE`, provado internamente pelas tabelas de PII que **têm** FK pra `orgs`); a de timestamptz era **parcial** (funciona hoje só porque todo write-path usa `.toISOString()`, invariante que o banco não impõe; e `appointments` já usa `timestamptz` com domain `string`, desmentindo o custo). D1 e D2 abaixo refletem a decisão revertida. O brief 0066 foi corrigido via `/feature revise` e mantém só perf-por-medição.

Três coisas que a auditoria **confirmou serem corretas** e que esta ADR registra explicitamente pra não serem "limpas" por engano:

- **`version`** é essencial. Em `events` é o lock otimista DB-enforced (`UNIQUE(aggregate_id, version)`, ADR 0012 D3); nas projeções é a réplica do `_version` do último evento aplicado, necessária pra rehidratar/replay. Prova de que não é boilerplate: `message_templates` — a única tabela org-scoped não-event-sourced (escrita direta `.set`) — é a única **sem** coluna `version`. Não há nenhum `WHERE version = $` no `src` (a concorrência é 100% do `UNIQUE` em `events`).
- **Snapshots** (`appointments.service_price_cents_snapshot`/`commission_snapshot`/`cancellation_policy_snapshot`, `orders.items`, `subscriptions.plan`, `commissions.attributed_member_name`/`item_name`) são **snapshot-on-use** (ADR 0010 D3) e ledger append-only — imutabilidade histórica deliberada. **Não são duplicação a remover.**
- **`public_org_directory`** é cópia desnormalizada de `orgs` para resolução pública `slug → org` sem furar RLS; o no-drift é garantido por construção (escrita das duas linhas na mesma transação em `org-projector.ts`). Trade-off correto.
- A separação **`professionals` vs `memberships`** é fronteira deliberada de bounded-context (briefs 0059/0060), segurança (memberships é top-level RLS-exempt; professionals é org-scoped sob RLS) e LGPD (`professionals_pii` severável por org). **Não é candidata a merge** — fundir seria regressão arquitetural.

## Decision

A relacionalização é **incremental, por item, ordenada por risco já existente** — nunca um big-bang. Cada decisão abaixo é uma fase independente com seu próprio blast radius; D1–D3 são tabela-a-tabela e **não tocam o seam** do `PersistencePort`; D6 (path) é a fundação que os demais tocam de raspão e vem **por último**.

### D1 — Datas `text` (ISO) → `timestamptz` (ALTO impacto, começar aqui)

~63 colunas de timestamp são `text` (ISO string, resíduo Firestore: o comentário recorrente "ISO timestamp (text, mirrors the domain `…: string | null`)" é a confissão). `timestamptz` só aparece onde uma feature forçou (`appointments.start_at/end_at` pela constraint GiST anti-double-book; `events`/`projections`/`*_events` por `defaultNow()`).

Já há **range/order em produção sobre strings** no caminho financeiro — o mais sensível:

- `features/reports/adapters/commissions.repo.ts:28-30` (`WHERE created_at >= $2 AND <= $3 ORDER BY created_at`), `sales.repo.ts:24-25`.
- `features/copilot/adapters/tracking.repo.ts:34-78`, `features/dashboard/adapters/trend.repo.ts:25-57`, `features/subscriptions/adapters/load-subscriptions.ts`, `features/orders/adapters/load-orders.ts:86`.
- `shared/org/notification-read.ts:113-118` ordena no DB e **re-ordena em JS** com `localeCompare` — resíduo dentro do resíduo.

Funciona só porque ISO-8601 ordena lexicograficamente = cronologicamente. Custo: zero validação de data no DB (`'banana'` passa), índices B-tree de texto, sem `date_trunc`/agregação temporal nativa sem cast.

**Decisão:** migrar as colunas temporais para `timestamptz`, **obedecendo a ADR 0009** (storage UTC; o display segue convertendo pro fuso da unidade — esta mudança é só de tipo de armazenamento, não muda o "relógio operacional"). Migração coluna-a-coluna (`ALTER … TYPE timestamptz USING col::timestamptz`), tabela isolável. **Não toca o seam.**

### D2 — Referências cross-aggregate viram FK (ALTO impacto)

Os únicos FKs do schema apontam pra `orgs.org_id`. As ~20 referências cross-aggregate (`customer_id`, `professional_id`, `service_id`, `category_id`, `order_id`, `subscription_id`, `appointment_id`, `customer_user_id`, `order_item_id`, `attributed_user_id`…) são `text` sem constraint — integridade 100% na app. O caso mais gritante: `catalog_items.category_id` referenciando `categories`, **chamado de "FK" no próprio comentário** (`categories.ts:7-9`) sem existir constraint.

**Decisão:** adicionar FKs incrementalmente, validando órfãos antes de cada constraint. **Ressalva deliberada:** referências que precisam **sobreviver à deleção/anonimização do alvo** (ex.: `commissions.attributed_user_id` — a comissão é ledger e sobrevive ao offboarding, por isso carrega `attributed_member_name` snapshot, ADR 0010) **não** ganham FK rígida, ou ganham `ON DELETE SET NULL` — a integridade aqui é intencionalmente frouxa. Decidir caso-a-caso, não varrer.

### D3 — Arrays N:N em JSONB → join tables (ALTO impacto)

`professionals.unit_ids`/`catalog_service_ids`, `catalog_items.unit_ids`, `subscription_plans.included_item_ids`/`included_category_ids`/`unit_allowlist` são relações N:N escondidas. O comentário racionaliza ("faithful to the reduced state without inventing relational shape"), mas o uso prova o contrário: apenas **4** queries usam `@>` no DB; **15+ sites** fazem fetch-all + filtro em JS com `.includes()`/`.some()` (`domain/utils/availability.ts:74-84`, `features/agenda/adapters/load-agenda.ts:85`, `features/catalog/adapters/catalog.actions.ts:306-322`, `features/self-book/adapters/public-org.ts:139-152`, etc.). "Profissionais da unidade X", "serviços da unidade X" — perguntas N:N clássicas resolvidas em memória.

**Decisão:** extrair join tables (`professional_units`, `professional_services`, `catalog_item_units`, `plan_included_items`, `plan_included_categories`), uma relação por vez, **começando pela mais consultada** (`professional ↔ unit`/`service`). **Tensão com o ES a resolver no design:** o array hoje é parte do _reduced state_ do aggregate; a join table é projeção derivada do mesmo evento — o projector passa a escrever a tabela-filha na mesma transação (igual evento+projeção da ADR 0012 D3). O reducer **não muda**; muda o projector.

### D4 — Limpeza da dívida _dentro_ do split professional/membership (MÉDIO impacto, baixo risco)

O split é correto (ver Context), mas carrega dívida interna:

- **Comissão com duas verdades:** `memberships.commission_rate` (escalar) **e** `professionals.default_commission` (jsonb). Consolidar numa só representação (a estruturada de professionals é a candidata; `commission_rate` em memberships sai).
- **`operational_status` materializado + evento próprio**, sendo 100% derivável (`domain/aggregates/professional/derive-operational.ts:25-32`: `whatsapp ∧ unit_ids≥1 ∧ catalog_service_ids≥1`). Candidato a **view/computed** em vez de coluna + evento; a materialização existe só por leitura barata do team page (`listProfessionalStatuses`). Avaliar custo de manter o evento vs view.
- **`memberships.unit_id` (singular, RLS-lock) vs `professionals.unit_ids[]` (atuação)** — nomes colidentes, semânticas distintas. Renomear o de RLS (ex.: `rls_unit_scope`) pra eliminar a confusão.
- **`role='customer'` vestigial:** está no enum de `memberships` mas o cadastro de cliente **não** cria membership (assimetria real com a tabela `customers`; `customer-upsert.ts` não toca membership). **Decisão de produto pendente:** ou remover do enum, ou definir o fluxo de self-signup do cliente final. Não é decisão técnica desta ADR — fica registrada como aberta.

### D5 — Itens deliberados que NÃO mudam (registro explícito)

- **`memberships.permissions` (jsonb):** redundante hoje (100% derivável de `role` via `defaultPermissionsForRole`, e **nenhum** dos ~26 checks de authz lê o bag — todos usam `role` direto). **Mantido** como base do RBAC granular futuro ("toggles, não migration"). Risco: drift estrutural possível (sem CHECK no bag). **Mitigação aceita:** toda escrita re-deriva; quando o RBAC granular entrar, adicionar validação. Não remover.
- **`projections` (KV genérico):** hoje **vazia** (18/18 aggregates têm projetor tipado registrado; teste assere count=0). É seam intencional do `PersistencePort`, não resíduo de documento. Manter; remover só se a política proibir código não-usado — decisão separada.
- **`orders.items` jsonb → tabela `order_items`:** ligado a D2/D3 (o delete-guard já faz `@>` em `items`, sinal de relação querida). **PRECISA-INVESTIGAR** — não decidido aqui; reavaliar depois de D2/D3, porque pode cair junto.

### D6 — `aggregate_path` → PK `(org_id, id)` (MÉDIO-ALTO, é o épico, por ÚLTIMO)

O formato `orgs/{orgId}/x/{id}` é resíduo Firestore declarado ("a legacy of the Firestore origin", `postgres-layer.ts:42`) e, na maioria das tabelas org-scoped, **redundante com `(org_id, id)`** que já são colunas. Mas hoje carrega 3 funções: (a) chave de roteamento do `PersistencePort` path-based (deriva tipo e org via `.split('/')`); (b) vira `events.aggregate_id`, base do `UNIQUE(aggregate_id, version)`; (c) o RLS deriva o org do path no write path, evitando threading de orgId.

**Decisão:** a identidade do aggregate vira um **tipo de domínio de primeira classe** e o path desaparece de toda a superfície:

1. **`AggregateRef { type, orgId, id }` como tipo nominal.** O `PersistencePort` fala `AggregateRef` (não `path: string`) em `load`/`append`; os reads de coleção falam `{ type, orgId }`. O `type` é uma **union fechada** derivada do registry — não `string` — então um type inexistente **não compila**. O ref é construído por `aggregateRef(config, orgId, id)`, derivando o `type` de `config.type` (que já existe, `event-store.ts:71`): impossível dessincronizar identidade e config, impossível digitar o type errado.
2. **`events.aggregate_id` = `id` puro** (não o path concatenado); `aggregate_type` e `org_id` são colunas tipadas ao lado. A unicidade vira `UNIQUE(aggregate_type, org_id, aggregate_id, version)`. Nenhuma string de path existe em lugar nenhum — nem interna ao `postgres-layer`.
3. **Mapa `type → tabela` explícito no registry.** Hoje `config.type` é singular (`'subscription'`) e a tabela é plural (`subscriptions`); a ponte é o `aggregateTypeOf(path)` extraindo o segmento plural da string. Com o path morto, o registry mapeia `config.type → tabela/projector` de forma explícita e tipada. `aggregateTypeOf`, `orgIdOf`, e os regex `EVENT_PATH`/`EVENTS_COLLECTION` são **deletados**.
4. **`(org_id, id)` vira PK** das 24 projeções org-scoped; `aggregate_path` é removido. `projections` (genérica), `message_templates` (`(org_id, type)`) e `orgs` (`UNIQUE(org_id)`) mantêm chaves próprias. As FKs compostas `(org_id, ref) → (org_id, id)` (D2) continuam válidas. `version` das projeções → `last_event_version` (carona; `events.version` inalterado).
5. **RLS deriva `org_id` do `SecurityContext` tipado** — o `ref.orgId` já é explícito no write path; o fallback `orgIdOf(path)` é removido. O caso especial `memberships/{orgId}_{userId}` (e o bug do `lastIndexOf('_')`, que quebra se `orgId` contém `_`) deixa de existir: membership vira `aggregateRef(MembershipConfig, orgId, id)` como qualquer outro aggregate.

Por que **tipo nominal derivado do config** e não objeto-literal `{type,orgId,id}` cru nos call-sites: as três invariantes que hoje vivem na disciplina de concatenar a string certa — (a) o type bate com a tabela, (b) o org isola o tenant, (c) a chave de evento é única — viram **garantias do compilador + do schema**. Cada um dos ~433 call-sites vira uma troca _compile-checked_ (errar não compila) em vez de concatenação livre: risco menor **e** modelo superior.

**Estratégia de entrega — drop & recreate** (revisão do faseamento "de dentro pra fora"): como o cutover #1202 nunca conectou Postgres em prod de verdade (sem dado vivo), o épico **não** carrega coexistência de chaves nem backfill. O schema Drizzle é reescrito já com a forma final, o histórico de migrations é regenerado do zero (squash), e o banco é recriado limpo. Materializado no brief 0069 (#1228 + 5 sub-issues). Sai do "por último/futuro" para **agora**, enquanto a janela sem dado vivo é barata.

> ⚠️ **PREMISSA SUPERADA (auditoria #1383, 2026-07-08).** A "janela sem dado vivo" **fechou**: oilio está em produção desde ~2026-07-02 com event store populado (ver [`0017-oilio-em-producao.md`](0017-oilio-em-producao.md)). Um **drop & recreate / squash / banco recriado limpo executado hoje destrói o event log de produção** (viola a imutabilidade append-only dos ADRs 0010/0012). Se o épico D6 for retomado, a estratégia de entrega **precisa ser re-desenhada** com migração de dado real (rename in-place não-destrutivo + upcaster-on-read), não drop & recreate. Não executar D6 sob esta premissa.

## Consequences

- **+** D1–D3 atacam custo **já existente** (queries financeiras frágeis sobre texto, N:N em memória, integridade só-na-app) e são **independentes do seam** — entregáveis incrementalmente sem mexer no event store.
- **+** Cada fase é uma migration isolável com rollback claro; nenhuma exige o big-bang que o cutover (corretamente) evitou.
- **+** Registra explicitamente o que **não** mexer (`version`, snapshots, `public_org_directory`, split professional/membership, `permissions`) — impede "limpezas" que seriam regressão.
- **−** D6 (path) é caro e toca o `PersistencePort`, `events`, RLS e PKs de ~24 tabelas; aceito como épico final, não pré-requisito de D1–D3.
- **−** D3 introduz tensão ES↔relacional (array no reduced state vs join table como projeção) que o design de cada extração precisa resolver — não é trivial copiar o array pra tabela.
- **Decisões de produto pendentes** (não técnicas): `role='customer'` vestigial (D4) e `orders.items` → `order_items` (D5) ficam **abertas**, reavaliadas no respectivo brief.
- **Fio condutor:** D1–D4 e D6 são a mesma raiz — relacionalizar um modelo portado como documento. Vale fazer, na ordem D1 → D2 → D3 → D4 (paralelo) → D6, porque o risco mora em D1–D3 e a fundação (D6) é o que todos tocam por último.

## Alternatives considered

- **Big-bang relacionalização (uma migration grande):** rejeitado. Maximiza blast radius e risco de cutover, exatamente o que a migração incremental por bounded context (ADR 0012) evitou de propósito. Sem dado em produção a migrar, ainda assim o custo de revisar ~100 call-sites de uma vez não se justifica contra o ganho incremental.
- **Manter tudo como está (o contrato Firestore é "bom o bastante"):** rejeitado pelo custo já concreto — queries financeiras sobre `text`, N:N filtrado em JS em 15+ sites, integridade referencial inexistente no banco. Não é dívida teórica.
- **Fundir `professionals` em `memberships` (DRY):** rejeitado. Violaria fronteira de bounded-context + dois regimes de RLS + contrato LGPD do sidecar. O alvo real é a dívida _dentro_ do split (D4), não a fusão.
- **Remover `version` das projeções:** rejeitado — é a réplica do `_version` necessária pra replay; sem ela o próximo append mis-versiona (`typed-projections.ts:36-40`). Renomear pra `last_event_version` é a única mudança aceitável (cosmética, reduz confusão com `events.version`) e pode entrar junto de D6.

# ADR 0014 — Autorização por capability (membro / own-scoped / manager / owner)

- **Status**: accepted
- **Date**: 2026-06-28
- **Deciders**: kaycabral
- **Briefs**: [0075 — Autorização por capability](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0075-autorizacao-granular-papeis) (materializa esta ADR) · [0076 — Modelo de membro por capability](https://gitlab.com/cbrl/cbrl/-/wikis/Produto/Funcionalidades/0076-modelo-membro-capability-perfil-operacional) (sequência: pendura o perfil operacional na membership)
- **Related ADRs**: [0004-multi-org-model](0004-multi-org-model.md) (membership vs entidades org-scoped — esta ADR refina a camada de autorização da aplicação) · [0010-event-sourcing-seletivo](0010-event-sourcing-seletivo.md) (`membership` é CRUD com snapshot-on-use — a matriz de permissions vive na projeção)

## Context

A autorização do app era **binária**: ou o membro gerencia a org (owner/manager, via `canManageOrg`) ou é "qualquer membro ativo" (`requireOrgCtx`). Faltava o nível intermediário que o negócio exige: um **profissional** que age apenas no próprio trabalho (vê/cria/cancela só os próprios agendamentos, vê só as próprias vendas), e uma **recepção** que opera o balcão de todos.

A `Membership` já carregava uma matriz de capabilities (`MembershipPermissions`) e a convenção canônica documentada era _"gate by `permissions.<capability>`, never by `role` directly"_ — mas as capabilities eram **campos mortos** (nunca usadas como gate) e ~24 call-sites gateavam por `role ===`/`canManageOrg(role)` direto, violando a própria convenção.

## Decision

A autorização da aplicação tem **quatro níveis**, gateados por **capability** (nunca por `role` direto):

1. **membro** — qualquer membership ativa (`requireOrgCtx`). Auth + org resolvidos.
2. **own-scoped** — age só sobre o recurso próprio (`canActOnOwnedResource`: o dono do recurso é `membership.userId`). É o profissional.
3. **manager** — owner/manager (`canManageOrg`). Gerencia a org.
4. **owner** — só o dono (`requireOwnerCtx`).

Mecanismo (em `src/shared/org/membership.ts`):

- `guardCapability(cap)` — a parede server-side real para uma capability da matriz; retorna o mesmo discriminated union dos guards de papel. **Distinto** de `requireCapability` (que é gate de **tier/plano**, ADR de billing — eixo ortogonal).
- `hasMembershipCapability(membership, cap)` — predicado puro, fonte única de leitura da matriz; nav, loaders e server actions derivam daqui, não de `role`.
- `operatesFrontDesk(membership)` — distingue o **balcão** (owner/manager/recepção) do **profissional self-scoped**. Marcador: `canManageCustomers` (a recepção tem; o profissional nunca).
- `canActOnOwnedResource(membership, ownerUserId)` — o balcão age sobre qualquer recurso; o profissional só sobre o próprio. Defense-in-depth sobre a RLS own-scope (`app.current_professional`).

Os quatro papéis (`owner`/`manager`/`professional`/`receptionist`) são **presets** de capability (`defaultPermissionsForRole`). O preset `professional` vem com `canHaveAgenda`/`canManageOwnAgenda`/`canCreateAppointment`/`canCancelAppointment` = `true` (autônomo own-scoped) e todo `canManage*` = `false`.

## Consequences

- **Pronto para roles customizáveis.** Como o gate é por capability, abrir "editar a capacidade de cada papel por negócio" no futuro é mudar os presets, não o código de gate. A estrutura já comporta.
- **Defense-in-depth real.** A UI esconde (nav/loader), a server action recusa (`guardCapability`/`canActOnOwnedResource`), e o banco recusa (RLS `app.current_professional`). Três camadas, a do banco provada por integration.
- **Eixo ortogonal a billing.** `guardCapability` (papel) e `requireCapability` (tier) coexistem — um membro pode ter a capability de papel e ainda ser barrado pelo plano, e vice-versa.
- **Sequência.** Esta ADR consolida a autorização por capability (brief 0075). O brief 0076 dá o passo seguinte: "ser comissionável/agendável" também vira capability, e o perfil operacional (`professionals`) passa a pender da membership — aposentando o brand de runtime `BookableProfessional`.

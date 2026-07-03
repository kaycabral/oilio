// Feature-level E2E — parent #1044 (epic 0028 "Profissional = membro").
//
// This is the PARENT's composite journey: it validates the brief's
// Definition of Done end-to-end (Cenários 1–4), not the granular replay/
// baseline already proven by the sub-issue specs. Each sub-issue spec proves
// one axis exhaustively against the emulator:
//   - memberOperations/invite-to-materialized.spec.ts  (#1045 · AC-01/02/03)
//   - memberOperations/identity-derived.spec.ts         (#1046 · AC-04/05 · Cen.3)
//   - memberOperations/approval-derived.spec.ts         (#1047 · AC-06/07 · Cen.2)
//   - memberOperations/baseline.spec.ts                 (CRUD baseline)
//   - shared/.../memberOperation-approval-replay.test.ts (replay, unit layer)
//
// Here we re-assert the SAME invariants at the cheapest level that still
// proves the composite contract, stitched into the one journey the owner
// lives: invite → accept → complete profile → operable, then the two
// guardrails (approval not hand-unlockable, identity derived) and the
// new-model coherence of the materialization path.
//
// Runs against the running emulator (no mocks). Drives the real invite-accept
// saga (OAuth surrogate via the auth emulator — password sign-in mints the
// same verified-email session the app sees from real OAuth).

import { formatBrazilPhone, membershipDocId } from '@/domain'
import {
  deriveOperationalStatus,
  MemberOperationConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { BrowserContext, Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  pgListByOrg,
  pgQueryProjection,
  pgReadEventStream,
  pgReadProjection,
  seedAuthUser,
  seedInvite,
  seedService,
  signInAndAttachSession,
  uniqueWhatsapp,
} from '../helpers/session'
import { MemberOperationsPage, orgSlug, PublicBookingPage } from '../pages'

// ── Postgres read-back decoders ───────────────────────────────────────────────
// Post-cutover the event store is Postgres (snake_case rows). These lenient
// Schemas decode only the columns the asserts touch; excess columns are ignored,
// so the richer real rows decode fine while staying fully typed (no `as`).

// The `users` global identity table — PII (display_name/whatsapp/email) lives here
// and the memberOperation detail page reads it live.
const UserRowSchema = Schema.Struct({
  uid: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  whatsapp: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
})
const decodeUserRow = Schema.decodeUnknownSync(UserRowSchema)

// The `member_operations` projection — the operational view of a member.
// `operational_status` is NOT a column (#1226 AC-02 — derived on read); the row
// carries the join arrays the derive needs.
const MemberOperationRowSchema = Schema.Struct({
  id: Schema.String,
  user_id: Schema.NullOr(Schema.String),
  unit_ids: Schema.Unknown,
  catalog_service_ids: Schema.Unknown,
})
const decodeMemberOperationRow = Schema.decodeUnknownSync(MemberOperationRowSchema)

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try {
      return asStringArray(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

// The event envelope stored in the `events` table (JSONB), as returned by
// `pgReadEventStream`. Only `_tag` is asserted directly; the whole envelope is
// stringified to prove PII never lands in the payload.
const EventEnvelopeSchema = Schema.Struct({ _tag: Schema.String })
const decodeEventEnvelope = Schema.decodeUnknownSync(EventEnvelopeSchema)

type StoredPro = { id: string; userId: string | null; operationalStatus: string | null }

// Reads the global `users/{uid}` row from Postgres (the `users` table keys on
// `uid`, not an aggregate path). Returns null when absent.
async function readUserRow(uid: string): Promise<{
  displayName: string | null
  whatsapp: string | null
  email: string | null
} | null> {
  const rows = await pgQueryProjection('users', 'uid', uid)
  const match = rows.find((r) => r.uid === uid)
  if (!match) return null
  const decoded = decodeUserRow(match)
  return { displayName: decoded.display_name, whatsapp: decoded.whatsapp, email: decoded.email }
}

// Reads a required identity string off the `users/{uid}` row. Module-level (not a
// closure inside the test) so the presence guard isn't a conditional-in-test;
// throws when the field is absent/null, surfacing a seeding/derivation bug.
function requireUserStr(
  user: { displayName: string | null; whatsapp: string | null; email: string | null },
  uid: string,
  key: 'displayName' | 'whatsapp' | 'email',
): string {
  const value = user[key]
  if (value === null) {
    throw new Error(`users/${uid}.${key} is null`)
  }
  return value
}

// Lists the org's MemberOperation projection rows from Postgres, mapped to the
// camelCase shape the asserts use. `operationalStatus` is DERIVED on read (#1226
// AC-02) from the linked User's whatsapp + the projection's units/services —
// exactly like the production read layer.
async function listMemberOperations(orgId: string): Promise<StoredPro[]> {
  const rows = await pgListByOrg('member_operations', orgId)
  const out: StoredPro[] = []
  for (const r of rows) {
    const decoded = decodeMemberOperationRow(r)
    const user = decoded.user_id ? await readUserRow(decoded.user_id) : null
    const operationalStatus = deriveOperationalStatus({
      inviteAccepted: true,
      whatsapp: user?.whatsapp ?? null,
      unitIds: asStringArray(decoded.unit_ids),
      catalogServiceIds: asStringArray(decoded.catalog_service_ids),
    })
    out.push({ id: decoded.id, userId: decoded.user_id, operationalStatus })
  }
  return out
}

// PATCH the linked User's whatsapp directly on the Postgres `users` table. The
// `User` union forbids a COMPLETED account with a null whatsapp, so nulling
// whatsapp must also flip `completion_completed` back to false (a legal
// `UserIncomplete`); restoring a whatsapp re-completes the account. Without this
// the row fails every union branch and the strict-decoding read boundary crashes
// the page.
async function patchUserWhatsapp(uid: string, whatsapp: string | null): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('UPDATE users SET whatsapp = $1, completion_completed = $2 WHERE uid = $3', [
      whatsapp,
      whatsapp !== null,
      uid,
    ])
  } finally {
    await client.end()
  }
}

// Drives the real invite-accept saga: seed an invite for `role`, sign the
// invitee's session in, accept via the UI. Returns the materialized
// memberOperation id (or null when the role isn't memberOperation).
async function inviteAccept(opts: {
  org: { orgId: string; uid: string }
  context: BrowserContext
  page: Page
  baseURL: string | undefined
  role: 'member_operator' | 'manager'
  invitee: { uid: string; email: string; password: string }
}): Promise<void> {
  const { inviteId, rawToken } = await seedInvite({
    orgId: opts.org.orgId,
    whatsapp: `5511${String(Date.now()).slice(-9)}`,
    role: opts.role,
    invitedBy: opts.org.uid,
  })
  await signInAndAttachSession(
    opts.context,
    opts.invitee.email,
    opts.invitee.password,
    opts.baseURL ?? undefined,
  )
  await opts.page.goto(`/invites/${opts.org.orgId}/${inviteId}?token=${rawToken}`)
  await opts.page.getByRole('button', { name: /aceitar convite/i }).click()
  // Post-accept landing is role-aware: a manager reaches the (manager-only)
  // Dashboard; a memberOperation lands on `/agenda` (the org has an appointment
  // unit). Sending a non-manager to `/dashboard` would just bounce them off.
  const landing = opts.role === 'manager' ? /\/dashboard/ : /\/agenda/
  await expect(opts.page).toHaveURL(landing, { timeout: 10_000 })
}

test.describe('Profissional = membro — Definition of Done (#1044)', { tag: '@journey' }, () => {
  // ── Cenário 1 — convite → aceite → perfil → operável [critical] ──────────────
  // O caminho-feliz inteiro do owner: convida role=memberOperation, o convidado
  // aceita (OAuth), o WhatsApp vem da identidade (completion step #838), o
  // manager atribui serviço pelo form operacional. Ao fim existe UM MemberOperation
  // com userId = uid do convidado, identidade == users/{uid}, operationalStatus
  // derivado `operational`, visível na agenda pública — sem duplicado nem userId nulo.
  test.describe('Cenário 1 — convite → aceite → perfil → operável', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('owner convida Profissional, convidado aceita e completa perfil → operável (1 pro, userId não-nulo, identidade derivada, operational, na agenda)', async ({
      org,
      context,
      page,
      authedPage,
      baseURL,
    }) => {
      // Pré-condições do cenário: ≥1 unidade (seedada), ≥1 serviço público na unidade.
      const unitId = org.unitIds[0]!
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Jornada',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      // Nenhum profissional antes do aceite — a asserção de "um só" é inequívoca.
      expect(await listMemberOperations(org.orgId)).toHaveLength(0)

      // Maria aceita o convite por OAuth (email verificado). seedAuthUser fixa
      // displayName 'E2E Invitee' + whatsapp 5511900000000 (o WA que o completion
      // step #838 coletaria na 1ª sessão).
      const maria = await seedAuthUser()
      await inviteAccept({ org, context, page, baseURL, role: 'member_operator', invitee: maria })

      // O aceite reescreveu o cookie `__session` do context com a sessão da Maria
      // (memberOperation). O resto do cenário é a perspectiva do MANAGER (owner) —
      // re-anexa a sessão do owner pro `authedPage` antes de abrir o cadastro.
      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      // Membership nasceu com role memberOperation (1º passo da saga).
      const m = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, maria.uid)),
      )
      expect(m).not.toBeNull()
      expect(m?.role).toBe('member_operator')

      // Exatamente UM MemberOperation materializado, userId = uid da Maria (não-nulo).
      let pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)

      // Identidade do profissional == users/{uid} (derivada ao vivo, AC-04/05).
      // Pós-#1085 + refino (review 2026-06-02) a edição operacional vive no
      // detalhe do membro (`/team/{uid}`), mostrada direto sem gate "Editar";
      // nome/WhatsApp/email ficam read-only no topo da página.
      const prosPage = new MemberOperationsPage(authedPage)
      await prosPage.gotoByUserId(maria.uid)
      const user = await readUserRow(maria.uid)
      expect(user).not.toBeNull()
      const identity = user ?? { displayName: null, whatsapp: null, email: null }
      await expect(prosPage.identityName()).toHaveText(
        requireUserStr(identity, maria.uid, 'displayName'),
      )
      await expect(prosPage.identityWhatsapp()).toHaveText(
        formatBrazilPhone(requireUserStr(identity, maria.uid, 'whatsapp')),
      )
      await expect(prosPage.identityEmail()).toContainText(
        requireUserStr(identity, maria.uid, 'email'),
      )

      // Recém-materializado, o perfil ainda está incompleto (sem unidade/serviço):
      // a saga emite `member_operation.created` com status `incomplete`
      // ("Cadastro incompleto") — derivado, nunca hardcoded operational.
      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      // O manager atribui unidade + serviço pelo form operacional — só então o
      // serviço fica elegível (filtrado pela interseção unidade↔serviço). Essa
      // mutação re-deriva o status e emite `member_operation.activated` (sem escrita
      // manual de status).
      await authedPage.getByRole('checkbox', { name: 'Unidade 1' }).check()
      await authedPage.getByRole('checkbox', { name: 'Corte Jornada' }).check()
      await prosPage.saveButton().click()
      // Pós-#1085 o save não redireciona (o detalhe do membro permanece) —
      // confirma in-place.
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      // operationalStatus virou `operational` sozinho (derivado).
      await prosPage.gotoByUserId(maria.uid)
      await expect(prosPage.operationalStatus()).toHaveText('Operacional')
      pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)
      expect(pros[0]!.operationalStatus).toBe('operational')

      // Maria aparece na agenda/catálogo público pro serviço que executa.
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('E2E Invitee').first()).toBeVisible()
    })
  })

  // ── Cenário 2 — status não destravável à mão [critical] ───────────────────
  // Um profissional aceito mas com perfil incompleto (sem WhatsApp / sem serviço)
  // permanece `incomplete`: não há caminho de UI/action pra escrever
  // operationalStatus, e ele NÃO aparece na agenda pública até o perfil completar.
  test.describe('Cenário 2 — status não destravável à mão', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'incomplete',
      },
    })

    test('sem WhatsApp/serviço fica incompleto, sem input de status e fora da agenda pública', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!
      // Tira o WhatsApp do User vinculado — perfil incompleto em dois eixos.
      await patchUserWhatsapp(`e2e-prof-user-${proId}`, null)

      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const prosPage = new MemberOperationsPage(authedPage)
      await prosPage.gotoById(proId)
      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      // NÃO há caminho de UI pra escrever o status (AC-06): sem <select>, sem
      // qualquer field nomeado operationalStatus.
      await expect(authedPage.locator('select[name="operationalStatus"]')).toHaveCount(0)
      await expect(authedPage.locator('[name="operationalStatus"]')).toHaveCount(0)

      // Off da agenda pública (executa serviço nenhum → indisponível).
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('Profissional 1')).toHaveCount(0)
    })
  })

  // ── Cenário 3 — identidade derivada, sem divergência [critical] ──────────────
  // No cadastro do profissional, nome/WhatsApp/email são read-only (origem
  // users/{userId}); só unidade(s)/serviço(s)/comissão/identidade fiscal são
  // editáveis. Alterar o WhatsApp do User reflete sem reescrita manual.
  test.describe('Cenário 3 — identidade derivada, sem divergência', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('identidade read-only espelha users/{userId}; alterar User.whatsapp reflete sem reescrever a projeção', async ({
      org,
      authedPage,
    }) => {
      const proId = org.memberOperationIds[0]!
      const uid = `e2e-prof-user-${proId}`
      const prosPage = new MemberOperationsPage(authedPage)

      await prosPage.gotoById(proId)
      // Identidade pessoal não é editável (sem inputs); fica read-only.
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
      // WhatsApp inicial do pro é gerado único por run (unicidade global) —
      // assert o formato BR-mascarado, não um literal.
      await expect(prosPage.identityWhatsapp()).toHaveText(/^\(\d{2}\) \d{5}-\d{4}$/)

      // Muta SÓ o User global — sem tocar a projeção do profissional. Número
      // novo gerado único (não pode colidir com outro User sob o índice global).
      const newWhatsapp = uniqueWhatsapp()
      await patchUserWhatsapp(uid, newWhatsapp)

      // Re-lê o cadastro: o novo WhatsApp aparece ao vivo (leitura derivada).
      await prosPage.gotoById(proId)
      await expect(prosPage.identityWhatsapp()).toHaveText(formatBrazilPhone(newWhatsapp))
    })
  })

  // ── Cenário 4 — seed nasce no modelo novo [edge] ─────────────────────────────
  // Projeto pré-prod → sem migração de legado. O caminho de materialização (o
  // MESMO que o seed reescrito #1048 usa: membership role=memberOperation →
  // member_operation.created com userId, sem PII no evento, approval `none` →
  // `approved` derivado por evento) prova o modelo novo. Em vez de re-rodar o
  // seed (que perturbaria o ambiente vivo), exercitamos o caminho que nasce o
  // profissional e conferimos a forma event-sourced: userId não-nulo, evento
  // sem identidade pessoal, approval derivado por evento (replayable), nunca
  // userId: null + approved hardcoded.
  test.describe('Cenário 4 — seed/modelo novo: materialização event-sourced sem userId nulo nem status hardcoded', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('o profissional nasce só da saga (membership → member_operation.created com userId, sem PII no evento, approval derivado)', async ({
      org,
      context,
      page,
      baseURL,
    }) => {
      const invitee = await seedAuthUser()
      await inviteAccept({ org, context, page, baseURL, role: 'member_operator', invitee })

      // Membership role=memberOperation + MemberOperation materializado com userId não-nulo.
      const m = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, invitee.uid)),
      )
      expect(m?.role).toBe('member_operator')
      const pros = await listMemberOperations(org.orgId)
      expect(pros).toHaveLength(1)
      const proId = pros[0]!.id
      expect(pros[0]!.userId).toBe(invitee.uid)
      expect(pros[0]!.userId).not.toBeNull()

      // O evento `member_operation.created` (v000001) é a fonte de verdade — append-only.
      // PII (name/whatsapp/email) NUNCA entra no envelope (ADR 0010); a identidade
      // vive só em users/{userId} (lida ao vivo). operationalStatus NÃO é hardcoded:
      // o created nasce `incomplete` e a transição é por evento derivado.
      const eventStream = await pgReadEventStream(
        aggregateRef(MemberOperationConfig, org.orgId, proId),
      )
      const created = eventStream[0]
      expect(decodeEventEnvelope(created)._tag).toBe('member_operation.created')
      const envelopeJson = JSON.stringify(created)
      expect(envelopeJson).not.toContain('E2E Invitee')
      // WhatsApp é gerado único por run — lê o valor real do User pra provar a
      // ausência da PII no envelope (em vez de um literal fixo).
      const inviteeUserRows = await pgQueryProjection('users', 'uid', invitee.uid)
      const inviteeWhatsapp = inviteeUserRows[0]?.whatsapp
      expect(inviteeWhatsapp).toMatch(/^5511\d{9}$/)
      expect(envelopeJson).not.toContain(String(inviteeWhatsapp))
      expect(envelopeJson).not.toContain(invitee.email)

      // O created projeta status `incomplete` (perfil ainda incompleto: sem
      // serviço) — derivado, não escrito à mão.
      expect(pros[0]!.operationalStatus).toBe('incomplete')
    })
  })
})

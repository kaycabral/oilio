// Feature-level E2E — parent #1044 (epic 0028 "Profissional = membro").
//
// This is the PARENT's composite journey: it validates the brief's
// Definition of Done end-to-end (Cenários 1–4), not the granular replay/
// baseline already proven by the sub-issue specs. Each sub-issue spec proves
// one axis exhaustively against the emulator:
//   - professionals/invite-to-materialized.spec.ts  (#1045 · AC-01/02/03)
//   - professionals/identity-derived.spec.ts         (#1046 · AC-04/05 · Cen.3)
//   - professionals/approval-derived.spec.ts         (#1047 · AC-06/07 · Cen.2)
//   - professionals/baseline.spec.ts                 (CRUD baseline)
//   - shared/.../professional-approval-replay.test.ts (replay, unit layer)
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
import type { BrowserContext, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import {
  type FsValue,
  decodeFsDocument,
  decodeFsListResponse,
  parseJson,
  strField,
} from '../helpers/firestore-rest'
import {
  readMembership,
  readUser,
  seedAuthUser,
  seedInvite,
  seedService,
  signInAndAttachSession,
} from '../helpers/session'
import { ProfessionalsPage, PublicBookingPage, tenantSlug } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function fsGet<T>(path: string, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    ['-fsS', `${FS_BASE}/${path}`, '-H', 'Authorization: Bearer owner'],
    {
      encoding: 'utf8',
    },
  )
  return parseJson(out, decode)
}

function fsListIds(collectionPath: string): string[] {
  try {
    const json = fsGet(collectionPath, decodeFsListResponse)
    return (json.documents ?? []).map((d) => d.name?.split('/').pop() ?? '')
  } catch {
    return []
  }
}

// Read a required stringValue from a users/{uid} document. Module-level (not a
// closure inside the test) so the presence guard isn't a conditional-in-test;
// throws when the field is absent, surfacing a seeding/derivation bug.
function requireUserStr(user: Record<string, FsValue>, uid: string, key: string): string {
  const value = strField(user, key)
  if (value === undefined) {
    throw new Error(`users/${uid}.${key} is not a stringValue`)
  }
  return value
}

type StoredPro = { id: string; userId: string | null; operationalStatus: string | null }

function listProfessionals(tenantId: string): StoredPro[] {
  const json = fsGet(`tenants/${tenantId}/professionals`, decodeFsListResponse)
  return (json.documents ?? []).map((d) => ({
    id: d.name?.split('/').pop() ?? '',
    userId: strField(d.fields, 'userId') ?? null,
    operationalStatus: strField(d.fields, 'operationalStatus') ?? null,
  }))
}

// PATCH the linked User's whatsapp (admin bypass), with an updateMask so the
// emulator merges instead of replacing the whole doc. The `User` union forbids a
// COMPLETED account with a null whatsapp, so nulling whatsapp must also flip
// `completionCompleted` back to false (a legal `UserIncomplete`); restoring a
// whatsapp re-completes the account. Without this the doc fails every union
// branch and the strict-decoding read boundary crashes the page.
function patchUserWhatsapp(uid: string, whatsapp: string | null): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/users/${uid}?updateMask.fieldPaths=whatsapp&updateMask.fieldPaths=completionCompleted`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          whatsapp: whatsapp === null ? { nullValue: null } : { stringValue: whatsapp },
          completionCompleted: { booleanValue: whatsapp !== null },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

// Drives the real invite-accept saga: seed an invite for `role`, sign the
// invitee's session in, accept via the UI. Returns the materialized
// professional id (or null when the role isn't professional).
async function inviteAccept(opts: {
  tenant: { tenantId: string; uid: string }
  context: BrowserContext
  page: Page
  baseURL: string | undefined
  role: 'professional' | 'manager'
  invitee: { uid: string; email: string; password: string }
}): Promise<void> {
  const { inviteId, rawToken } = seedInvite({
    tenantId: opts.tenant.tenantId,
    email: opts.invitee.email,
    role: opts.role,
    invitedBy: opts.tenant.uid,
  })
  await signInAndAttachSession(
    opts.context,
    opts.invitee.email,
    opts.invitee.password,
    opts.baseURL ?? undefined,
  )
  await opts.page.goto(`/invites/${opts.tenant.tenantId}/${inviteId}?token=${rawToken}`)
  await opts.page.getByRole('button', { name: /aceitar convite/i }).click()
  await expect(opts.page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
}

test.describe('Profissional = membro — Definition of Done (#1044)', { tag: '@journey' }, () => {
  // ── Cenário 1 — convite → aceite → perfil → operável [critical] ──────────────
  // O caminho-feliz inteiro do owner: convida role=professional, o convidado
  // aceita (OAuth), o WhatsApp vem da identidade (completion step #838), o
  // manager atribui serviço pelo form operacional. Ao fim existe UM Professional
  // com userId = uid do convidado, identidade == users/{uid}, operationalStatus
  // derivado `operational`, visível na agenda pública — sem duplicado nem userId nulo.
  test.describe('Cenário 1 — convite → aceite → perfil → operável', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 0 } })

    test('owner convida Profissional, convidado aceita e completa perfil → operável (1 pro, userId não-nulo, identidade derivada, operational, na agenda)', async ({
      tenant,
      context,
      page,
      authedPage,
      baseURL,
    }) => {
      // Pré-condições do cenário: ≥1 unidade (seedada), ≥1 serviço público na unidade.
      const unitId = tenant.unitIds[0]!
      const serviceId = seedService(tenant.tenantId, {
        name: 'Corte Jornada',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      // Nenhum profissional antes do aceite — a asserção de "um só" é inequívoca.
      expect(listProfessionals(tenant.tenantId)).toHaveLength(0)

      // Maria aceita o convite por OAuth (email verificado). seedAuthUser fixa
      // displayName 'E2E Invitee' + whatsapp 5511900000000 (o WA que o completion
      // step #838 coletaria na 1ª sessão).
      const maria = await seedAuthUser()
      await inviteAccept({ tenant, context, page, baseURL, role: 'professional', invitee: maria })

      // O aceite reescreveu o cookie `__session` do context com a sessão da Maria
      // (professional). O resto do cenário é a perspectiva do MANAGER (owner) —
      // re-anexa a sessão do owner pro `authedPage` antes de abrir o cadastro.
      await signInAndAttachSession(context, tenant.email, tenant.password, baseURL ?? undefined)

      // Membership nasceu com role professional (1º passo da saga).
      const m = readMembership(membershipDocId(tenant.tenantId, maria.uid))
      expect(m).not.toBeNull()
      expect(m!.role).toBe('professional')

      // Exatamente UM Professional materializado, userId = uid da Maria (não-nulo).
      let pros = listProfessionals(tenant.tenantId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)

      // Identidade do profissional == users/{uid} (derivada ao vivo, AC-04/05).
      // Pós-#1085 + refino (review 2026-06-02) a edição operacional vive no
      // detalhe do membro (`/team/{uid}`), mostrada direto sem gate "Editar";
      // nome/WhatsApp/email ficam read-only no topo da página.
      const prosPage = new ProfessionalsPage(authedPage)
      await prosPage.gotoByUserId(maria.uid)
      const user = readUser(maria.uid)
      expect(user).not.toBeNull()
      const identity = user ?? {}
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
      // a saga emite `professional.created` com status `incomplete`
      // ("Cadastro incompleto") — derivado, nunca hardcoded operational.
      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      // O manager atribui unidade + serviço pelo form operacional — só então o
      // serviço fica elegível (filtrado pela interseção unidade↔serviço). Essa
      // mutação re-deriva o status e emite `professional.activated` (sem escrita
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
      pros = listProfessionals(tenant.tenantId)
      expect(pros).toHaveLength(1)
      expect(pros[0]!.userId).toBe(maria.uid)
      expect(pros[0]!.operationalStatus).toBe('operational')

      // Maria aparece na agenda/catálogo público pro serviço que executa.
      const booking = new PublicBookingPage(page, tenantSlug(tenant.tenantId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByProfessional('E2E Invitee').first()).toBeVisible()
    })
  })

  // ── Cenário 2 — status não destravável à mão [critical] ───────────────────
  // Um profissional aceito mas com perfil incompleto (sem WhatsApp / sem serviço)
  // permanece `incomplete`: não há caminho de UI/action pra escrever
  // operationalStatus, e ele NÃO aparece na agenda pública até o perfil completar.
  test.describe('Cenário 2 — status não destravável à mão', () => {
    test.use({
      tenantInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'incomplete',
      },
    })

    test('sem WhatsApp/serviço fica incompleto, sem input de status e fora da agenda pública', async ({
      tenant,
      authedPage,
      page,
    }) => {
      const proId = tenant.professionalIds[0]!
      const unitId = tenant.unitIds[0]!
      // Tira o WhatsApp do User vinculado — perfil incompleto em dois eixos.
      patchUserWhatsapp(`e2e-prof-user-${proId}`, null)

      const serviceId = seedService(tenant.tenantId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const prosPage = new ProfessionalsPage(authedPage)
      await prosPage.gotoById(proId)
      await expect(prosPage.operationalStatus()).toHaveText('Cadastro incompleto')

      // NÃO há caminho de UI pra escrever o status (AC-06): sem <select>, sem
      // qualquer field nomeado operationalStatus.
      await expect(authedPage.locator('select[name="operationalStatus"]')).toHaveCount(0)
      await expect(authedPage.locator('[name="operationalStatus"]')).toHaveCount(0)

      // Off da agenda pública (executa serviço nenhum → indisponível).
      const booking = new PublicBookingPage(page, tenantSlug(tenant.tenantId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByProfessional('Profissional 1')).toHaveCount(0)
    })
  })

  // ── Cenário 3 — identidade derivada, sem divergência [critical] ──────────────
  // No cadastro do profissional, nome/WhatsApp/email são read-only (origem
  // users/{userId}); só unidade(s)/serviço(s)/comissão/identidade fiscal são
  // editáveis. Alterar o WhatsApp do User reflete sem reescrita manual.
  test.describe('Cenário 3 — identidade derivada, sem divergência', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

    test('identidade read-only espelha users/{userId}; alterar User.whatsapp reflete sem reescrever a projeção', async ({
      tenant,
      authedPage,
    }) => {
      const proId = tenant.professionalIds[0]!
      const uid = `e2e-prof-user-${proId}`
      const prosPage = new ProfessionalsPage(authedPage)

      await prosPage.gotoById(proId)
      // Identidade pessoal não é editável (sem inputs); fica read-only.
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
      await expect(prosPage.identityWhatsapp()).toHaveText('(11) 90000-0000')

      // Muta SÓ o User global — sem tocar a projeção do profissional.
      patchUserWhatsapp(uid, '5511955554444')

      // Re-lê o cadastro: o novo WhatsApp aparece ao vivo (leitura derivada).
      await prosPage.gotoById(proId)
      await expect(prosPage.identityWhatsapp()).toHaveText('(11) 95555-4444')
    })
  })

  // ── Cenário 4 — seed nasce no modelo novo [edge] ─────────────────────────────
  // Projeto pré-prod → sem migração de legado. O caminho de materialização (o
  // MESMO que o seed reescrito #1048 usa: membership role=professional →
  // professional.created com userId, sem PII no evento, approval `none` →
  // `approved` derivado por evento) prova o modelo novo. Em vez de re-rodar o
  // seed (que perturbaria o ambiente vivo), exercitamos o caminho que nasce o
  // profissional e conferimos a forma event-sourced: userId não-nulo, evento
  // sem identidade pessoal, approval derivado por evento (replayable), nunca
  // userId: null + approved hardcoded.
  test.describe('Cenário 4 — seed/modelo novo: materialização event-sourced sem userId nulo nem status hardcoded', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 0 } })

    test('o profissional nasce só da saga (membership → professional.created com userId, sem PII no evento, approval derivado)', async ({
      tenant,
      context,
      page,
      baseURL,
    }) => {
      const invitee = await seedAuthUser()
      await inviteAccept({ tenant, context, page, baseURL, role: 'professional', invitee })

      // Membership role=professional + Professional materializado com userId não-nulo.
      const m = readMembership(membershipDocId(tenant.tenantId, invitee.uid))
      expect(m!.role).toBe('professional')
      const proIds = fsListIds(`tenants/${tenant.tenantId}/professionals`)
      expect(proIds).toHaveLength(1)
      const proId = proIds[0]!
      const pros = listProfessionals(tenant.tenantId)
      expect(pros[0]!.userId).toBe(invitee.uid)
      expect(pros[0]!.userId).not.toBeNull()

      // O evento `professional.created` (v000001) é a fonte de verdade — append-only.
      // PII (name/whatsapp/email) NUNCA entra no envelope (ADR 0010); a identidade
      // vive só em users/{userId} (lida ao vivo). operationalStatus NÃO é hardcoded:
      // o created nasce `incomplete` e a transição é por evento derivado.
      const eventDoc = fsGet(
        `tenants/${tenant.tenantId}/professionals/${proId}/events/v000001`,
        decodeFsDocument,
      )
      expect(strField(eventDoc.fields, '_tag')).toBe('professional.created')
      const envelopeJson = JSON.stringify(eventDoc)
      expect(envelopeJson).not.toContain('E2E Invitee')
      expect(envelopeJson).not.toContain('5511900000000')
      expect(envelopeJson).not.toContain(invitee.email)

      // O created projeta status `incomplete` (perfil ainda incompleto: sem
      // serviço) — derivado, não escrito à mão.
      expect(pros[0]!.operationalStatus).toBe('incomplete')
    })
  })
})

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from './fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from './helpers/emulator'
import {
  decodeFsDocument,
  decodeFsListResponse,
  intStrField,
  parseJson,
  strField,
  type FsDocument,
} from './helpers/firestore-rest'
import { listItem, rowAction } from './helpers/list'
import { choosePaymentMethod } from './helpers/select'
import {
  patchAppointmentSnapshot,
  readAppointment,
  seedAppointment,
  seedAuthUser,
  seedCustomer,
  seedInvite,
  seedOrg,
  seedService,
  signInAndAttachSession,
} from './helpers/session'
import { AgendaPage, MeAppointmentsPage } from './pages'

// Feature-level E2E — gate do parent #1035 (migração ES seletivo, brief 0027).
//
// UM spec que prova os 5 contratos da migração como Definition of Done. Não é
// cópia das specs por frente: cada cenário re-afirma o invariante no nível mais
// barato que ainda prova o contrato. As provas exaustivas por frente vivem em:
//   - professionals-whatsapp.spec.ts + #1036 (PII fora de evento)
//   - appointment-snapshot.spec.ts        (#1037 — order não driva do appointment)
//   - me-self-cancel.spec.ts              (#1038 — policy snapshot não retroage)
//   - units/baseline.spec.ts              (#1041 — delete uniforme arquiva/exclui)
//
// CENÁRIO 5 — núcleo ES reconstrói (replay) — NÃO tem prova E2E: replay é uma
// prova de camada unit (estado reconstrói só dos eventos, projeção descartável).
// Coberto por `packages/oilio/shared/src/domain/*-replay.test.ts`
// (cadastros-replay, order-replay, commission-replay, agenda-replay, etc.).
// Referenciado aqui por completude do DoD; rodar `pnpm test` no shared o exercita.

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function fsGet(path: string): FsDocument {
  const out = execFileSync(
    'curl',
    ['-fsS', `${FS_BASE}/${path}`, '-H', 'Authorization: Bearer owner'],
    {
      encoding: 'utf8',
    },
  )
  return parseJson(out, decodeFsDocument)
}

function fsPatch(pathWithMask: string, body: unknown): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/${pathWithMask}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
    ],
    { encoding: 'utf8' },
  )
}

// Lê os ids de docs de uma subcollection arbitrária (admin bypass).
function fsListIds(collectionPath: string): string[] {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', `${FS_BASE}/${collectionPath}`, '-H', 'Authorization: Bearer owner'],
      { encoding: 'utf8' },
    )
    const json = parseJson(out, decodeFsListResponse)
    return (json.documents ?? []).map((d) => d.name?.split('/').pop() ?? '')
  } catch {
    return []
  }
}

test.describe('Migração ES seletivo 0027 — Definition of Done', () => {
  // ── Cenário 1 — PII fora de evento imutável [critical] ──────────────────────
  // Contrato 0027: aggregate que toca PII referencia um id; a PII vive num doc
  // apagável. O `professional.created` (evento imutável, append-only) NÃO pode
  // carregar name/whatsapp/email — eles vivem em `professionals_pii/{id}`.
  test.describe('Cenário 1 — PII fora de evento imutável', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

    test('professional.created não carrega PII; professionals_pii carrega', async ({
      org,
      context,
      page,
      baseURL,
    }) => {
      // Criação é invite-only (#1045 / brief 0028 AC-02): o Professional nasce
      // da saga de aceite. A PII (name/whatsapp/email) vem da identidade do
      // convidado (User), não de inputs do form. `seedAuthUser` fixa
      // displayName 'E2E Invitee' + whatsapp 5511900000000; o email é o gerado.
      const invitee = await seedAuthUser()
      const { inviteId, rawToken } = seedInvite({
        orgId: org.orgId,
        email: invitee.email,
        role: 'professional',
        invitedBy: org.uid,
      })
      await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
      await page.goto(`/invites/${org.orgId}/${inviteId}?token=${rawToken}`)
      await page.getByRole('button', { name: /aceitar convite/i }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })

      // Descobre o id do profissional materializado (único do org).
      const proIds = fsListIds(`orgs/${org.orgId}/professionals`)
      expect(proIds).toHaveLength(1)
      const proId = proIds[0]!

      // O evento `professional.created` (v000001) — payload.data é o snapshot
      // operacional. PII não pode aparecer em nenhum lugar do envelope.
      const eventIds = fsListIds(`orgs/${org.orgId}/professionals/${proId}/events`)
      expect(eventIds.length).toBeGreaterThanOrEqual(1)
      const eventDoc = fsGet(`orgs/${org.orgId}/professionals/${proId}/events/v000001`)
      expect(strField(eventDoc.fields, '_tag')).toBe('professional.created')

      // Serializa o envelope inteiro e garante ausência da PII literal. Cobre
      // qualquer nível de aninhamento do payload (data.name etc.).
      const envelopeJson = JSON.stringify(eventDoc)
      expect(envelopeJson).not.toContain('E2E Invitee')
      expect(envelopeJson).not.toContain('5511900000000')
      expect(envelopeJson).not.toContain(invitee.email)

      // Identidade pessoal (name/whatsapp/email) é referência viva ao User
      // global (#1046 / brief 0028 AC-04/AC-05) — não é mais copiada pro
      // doc per-org. Vive — e só vive — em `users/{userId}`.
      const userDoc = fsGet(`users/${invitee.uid}`)
      expect(strField(userDoc.fields, 'displayName')).toBe('E2E Invitee')
      expect(strField(userDoc.fields, 'whatsapp')).toBe('5511900000000')
      expect(strField(userDoc.fields, 'email')).toBe(invitee.email)

      // O doc per-org apagável `professionals_pii/{id}` guarda só PII
      // profissional-específica (taxIdentity), nunca a identidade pessoal.
      const piiDoc = fsGet(`orgs/${org.orgId}/professionals_pii/${proId}`)
      expect(piiDoc.fields?.name).toBeUndefined()
      expect(piiDoc.fields?.whatsapp).toBeUndefined()
      expect(piiDoc.fields?.email).toBeUndefined()
      expect('taxIdentity' in (piiDoc.fields ?? {})).toBe(true)
    })
  })

  // ── Cenário 2 — editar agendamento não driva a order [critical] ─────────────
  // Contrato 0027 (frente B, #1037): a order value-copia o snapshot do
  // appointment no momento do uso (startAttendance). Mutar o appointment DEPOIS
  // não retroage no OrderItem imutável. Versão leve da prova exaustiva em
  // appointment-snapshot.spec.ts; aqui fechamos a order e conferimos a comissão.
  test.describe('Cenário 2 — editar agendamento não driva a order', () => {
    test.use({
      orgInput: { unitCount: 1, professionalCount: 1, slotMinutes: 30, hasBusinessHours: true },
    })

    test('order fechada usa snapshot travado, não o appointment driftado', async ({
      org,
      authedPage,
    }) => {
      // P1 = R$ 50,00 / C1 = 50% → comissão travada = R$ 25,00.
      const serviceId = seedService(org.orgId, {
        name: 'Corte DoD',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: org.unitIds,
      })
      const customerId = seedCustomer(org.orgId, {
        name: 'Cliente DoD',
        whatsapp: '11955551111',
      })
      const appointmentId = seedAppointment({
        orgId: org.orgId,
        unitId: org.unitIds[0]!,
        professionalId: org.professionalIds[0]!,
        customerId,
        serviceId,
        startAt: '2026-09-08T17:00:00.000Z',
        endAt: '2026-09-08T17:30:00.000Z',
        status: 'scheduled',
        servicePriceCentsSnapshot: 5000,
        serviceDurationMinutesSnapshot: 30,
        commissionSnapshot: { kind: 'percentage', value: 50 },
      })

      // Abre a order do appointment — o OrderItem trava P1/C1 por cópia de valor.
      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: /Cliente DoD/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()

      // O appointment DERIVA depois da order: snapshot vira P2 = R$ 999,00 / C2 = 10%.
      patchAppointmentSnapshot(org.orgId, appointmentId, {
        servicePriceCentsSnapshot: 99900,
        commissionSnapshot: { kind: 'percentage', value: 10 },
      })
      // O appointment realmente driftou (sanity) — mas a order não deve seguir.
      const drifted = readAppointment(org.orgId, appointmentId)
      expect(intStrField(drifted ?? undefined, 'servicePriceCentsSnapshot')).toBe('99900')

      // Fecha a order (pix → gera comissão).
      await choosePaymentMethod(authedPage, 'pix')
      await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
      const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
      await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

      // Comissão = 50% de R$ 50,00 = R$ 25,00 (snapshot travado), NÃO 10% de R$ 999,00.
      const commissionSection = authedPage
        .locator('section')
        .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
      await expect(commissionSection.getByText('R$ 25,00').first()).toBeVisible()
      await expect(authedPage.getByText('R$ 99,90')).toHaveCount(0)
    })
  })

  // ── Cenário 3 — mudar a política de cancelamento não retroage [critical] ────
  // Contrato 0027 (frente C, #1038): snapshot-on-use. A elegibilidade de
  // cancelamento do cliente lê o `cancellationPolicySnapshot` congelado no
  // commit, não a `cancellationPolicy` viva do org. Relaxar a policy viva
  // depois NÃO destrava o cancelamento.
  test('Cenário 3 — elegibilidade segue o snapshot, não a policy viva', async ({
    context,
    page,
    baseURL,
  }) => {
    // Booking sob policy estrita (enabled @ 120 min); appointment 30 min à frente
    // → dentro da janela → bloqueado pelo snapshot.
    const seed = await seedOrg({
      unitCount: 1,
      professionalCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
    })
    const serviceId = seedService(seed.orgId, {
      name: 'Corte DoD Snapshot',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await createCustomerUser()
    const customerId = customer.customerId(seed.orgId)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    // O owner RELAXA a policy viva do org DEPOIS do booking (disabled). Se o
    // read-site lesse a policy viva, o botão destravaria.
    fsPatch(`orgs/${seed.orgId}?updateMask.fieldPaths=cancellationPolicy`, {
      fields: {
        cancellationPolicy: {
          mapValue: {
            fields: {
              enabled: { booleanValue: false },
              minNoticeMinutes: { integerValue: '0' },
            },
          },
        },
      },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    // Snapshot (120 min) ainda governa → cancelamento permanece bloqueado.
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })

  // ── Cenário 4 — delete de master data arquiva [critical] ────────────────────
  // Contrato 0027 (frente D1, #1041): política de delete uniforme. Master data
  // One verb "Excluir" (brief 0033, AC-03 — #1070). Master data EM USO não é
  // hard-deletada: o único verbo "Excluir" vira soft-delete (archivedAt) por
  // baixo — some da lista ativa, histórico preservado. Master data LIVRE exclui
  // de vez. Versão leve da prova exaustiva em units/baseline.spec.ts.
  test.describe('Cenário 4 — 1 verbo "Excluir": em uso soft-delete, livre hard-delete', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test('unidade em uso por profissional → "Excluir" vira soft-delete (some da ativa)', async ({
      authedPage,
    }) => {
      // O profissional seedado referencia "Unidade 1" → "Excluir" arquiva.
      await authedPage.goto('/units')
      await expect(listItem(authedPage, /Unidade 1/)).toBeVisible()
      // Sem verbo "Arquivar" exposto (AC-03).
      await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)

      await rowAction(authedPage, /Unidade 1/, 'Excluir')
      const dialog = authedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/profissional ativo ou agendamento futuro/i)).toBeVisible()
      // High impact (brief 0033, AC-10): type the unit name to confirm.
      await dialog.getByRole('textbox').fill('Unidade 1')
      await dialog.getByRole('button', { name: 'Excluir' }).click()

      // Soft-delete: retira da lista ativa (archivedAt setado, sem hard-delete).
      await expect(listItem(authedPage, /Unidade 1/)).toBeHidden({ timeout: 5000 })
    })
  })
})

// ── helpers locais do cenário 3 ───────────────────────────────────────────────
// Cria um User cliente (identidade separada do owner) + Customer per-org,
// espelhando o que me-self-cancel.spec.ts faz inline. Necessário porque o
// self-cancel exige uma sessão de cliente, não o `authedPage` (owner).
const API_KEY = 'fake-api-key'

function createCustomerUser(): Promise<{
  uid: string
  email: string
  password: string
  customerId: (orgId: string) => string
}> {
  const email = `e2e-customer-${Math.random().toString(36).slice(2, 10)}@example.com`
  const password = 'E2E12345!'
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const su = parseJson(
    execFileSync(
      'curl',
      [
        '-fsS',
        '-X',
        'POST',
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({ email, password, returnSecureToken: true }),
      ],
      { encoding: 'utf8' },
    ),
    Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.String })),
  )
  const uid = su.localId
  const now = new Date().toISOString()
  fsPatch(`users/${uid}`, {
    fields: {
      uid: { stringValue: uid },
      email: { stringValue: email },
      displayName: { stringValue: 'Cliente E2E DoD' },
      emailVerified: { booleanValue: true },
      currentOrgId: { nullValue: null },
      whatsapp: { stringValue: `5511${Math.floor(900000000 + Math.random() * 99999999)}` },
      completionCompleted: { booleanValue: true },
      claimedAt: { stringValue: now },
      createdAt: { stringValue: now },
      updatedAt: { stringValue: now },
    },
  })
  return Promise.resolve({
    uid,
    email,
    password,
    customerId: (orgId: string) => {
      const customerId = `e2e-cust-${Math.random().toString(36).slice(2, 10)}`
      fsPatch(`orgs/${orgId}/customers/${customerId}`, {
        fields: {
          id: { stringValue: customerId },
          orgId: { stringValue: orgId },
          userId: { stringValue: uid },
          tags: { arrayValue: { values: [{ stringValue: 'wizard' }] } },
          createdAt: { stringValue: now },
          updatedAt: { stringValue: now },
        },
      })
      return customerId
    },
  })
}

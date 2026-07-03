import { AppointmentConfig, MemberOperationConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from './fixtures'
import { listItem, rowAction } from './helpers/list'
import { choosePaymentMethod } from './helpers/select'
import {
  patchAppointmentSnapshot,
  pgListByOrg,
  pgQueryProjection,
  pgReadEventStream,
  pgReadProjection,
  seedAppointment,
  seedAuthUser,
  seedCustomer,
  seedCustomerShadowForUser,
  seedInvite,
  seedOrg,
  seedService,
  signInAndAttachSession,
  uniqueWhatsapp,
} from './helpers/session'
import { AgendaPage, MeAppointmentsPage } from './pages'

// Feature-level E2E — gate do parent #1035 (migração ES seletivo, brief 0027).
//
// UM spec que prova os 5 contratos da migração como Definition of Done. Não é
// cópia das specs por frente: cada cenário re-afirma o invariante no nível mais
// barato que ainda prova o contrato. As provas exaustivas por frente vivem em:
//   - memberOperations-whatsapp.spec.ts + #1036 (PII fora de evento)
//   - appointment-snapshot.spec.ts        (#1037 — order não driva do appointment)
//   - me-self-cancel.spec.ts              (#1038 — policy snapshot não retroage)
//   - units/baseline.spec.ts              (#1041 — delete uniforme arquiva/exclui)
//
// CENÁRIO 5 — núcleo ES reconstrói (replay) — NÃO tem prova E2E: replay é uma
// prova de camada unit (estado reconstrói só dos eventos, projeção descartável).
// Coberto por `packages/oilio/shared/src/domain/*-replay.test.ts`
// (cadastros-replay, order-replay, commission-replay, agenda-replay, etc.).
// Referenciado aqui por completude do DoD; rodar `pnpm test` no shared o exercita.

// Os read-backs assertam contra o Postgres (pós-cutover): a projeção tipada
// (snake_case), o stream de eventos (envelope JSONB) e a sidecar de PII. O
// envelope do evento é `{ _tag, version, timestamp, actorId, payload: { data } }`.
const EventTag = Schema.Struct({ _tag: Schema.String })
const decodeEventTag = Schema.decodeUnknownSync(EventTag)

// Narrows a projection column read as `unknown` to a definite string at the
// boundary (the conditional lives in the helper, not the test body — keeps
// `playwright/no-conditional-in-test` clean).
const requireString = Schema.decodeUnknownSync(Schema.String)

test.describe('Migração ES seletivo 0027 — Definition of Done', () => {
  // ── Cenário 1 — PII fora de evento imutável [critical] ──────────────────────
  // Contrato 0027: aggregate que toca PII referencia um id; a PII vive num doc
  // apagável. O `member_operation.created` (evento imutável, append-only) NÃO pode
  // carregar name/whatsapp/email — eles vivem em `member_operations_pii/{id}`.
  test.describe('Cenário 1 — PII fora de evento imutável', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('member_operation.created não carrega PII; member_operations_pii carrega', async ({
      org,
      context,
      page,
      baseURL,
    }) => {
      // Criação é invite-only (#1045 / brief 0028 AC-02): o MemberOperation nasce
      // da saga de aceite. A PII (name/whatsapp/email) vem da identidade do
      // convidado (User), não de inputs do form. `seedAuthUser` fixa
      // displayName 'E2E Invitee' + whatsapp 5511900000000; o email é o gerado.
      const invitee = await seedAuthUser()
      const { inviteId, rawToken } = await seedInvite({
        orgId: org.orgId,
        whatsapp: '5511990001234',
        role: 'member_operator',
        invitedBy: org.uid,
      })
      await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)
      await page.goto(`/invites/${org.orgId}/${inviteId}?token=${rawToken}`)
      await page.getByRole('button', { name: /aceitar convite/i }).click()
      // MemberOperation (non-manager) lands on `/agenda`, not the manager-only
      // Dashboard — the org has an appointment unit.
      await expect(page).toHaveURL(/\/agenda/, { timeout: 10_000 })

      // Descobre o id do profissional materializado (único do org) — pela
      // projeção tipada `member_operations` no Postgres.
      const proRows = await pgListByOrg('member_operations', org.orgId)
      expect(proRows).toHaveLength(1)
      const proId = requireString(proRows[0]?.id)
      const proRef = aggregateRef(MemberOperationConfig, org.orgId, proId)

      // O stream de eventos do aggregate. O primeiro evento é
      // `member_operation.created` (v1) — payload.data é o snapshot operacional.
      // PII não pode aparecer em nenhum lugar do envelope.
      const stream = await pgReadEventStream(proRef)
      expect(stream.length).toBeGreaterThanOrEqual(1)
      expect(decodeEventTag(stream[0])._tag).toBe('member_operation.created')

      // Identidade pessoal (name/whatsapp/email) é referência viva ao User
      // global (#1046 / brief 0028 AC-04/AC-05) — não é mais copiada pro
      // doc per-org. Vive — e só vive — na tabela global `users` (chave `uid`).
      // O whatsapp é gerado único por run (unicidade global), então lemos o
      // valor real daqui pra provar a ausência no evento logo abaixo.
      const userRows = await pgQueryProjection('users', 'uid', invitee.uid)
      expect(userRows).toHaveLength(1)
      const userRow = userRows[0]
      expect(userRow?.display_name).toBe('E2E Invitee')
      expect(userRow?.whatsapp).toMatch(/^5511\d{9}$/)
      expect(userRow?.email).toBe(invitee.email)

      // Serializa cada envelope do stream e garante ausência da PII literal.
      // Cobre qualquer nível de aninhamento do payload (data.name etc.).
      const streamJson = JSON.stringify(stream)
      expect(streamJson).not.toContain('E2E Invitee')
      expect(streamJson).not.toContain(requireString(userRow?.whatsapp))
      expect(streamJson).not.toContain(invitee.email)

      // O doc per-org apagável `member_operations_pii/{id}` guarda só PII
      // profissional-específica (tax_identity), nunca a identidade pessoal.
      // A tabela sidecar (aggregate_path, org_id, id, tax_identity) não tem
      // sequer coluna pra name/whatsapp/email — o contrato é estrutural.
      const piiRow = await pgReadProjection('member_operations_pii', proRef)
      expect(piiRow).not.toBeNull()
      expect(piiRow?.name).toBeUndefined()
      expect(piiRow?.whatsapp).toBeUndefined()
      expect(piiRow?.email).toBeUndefined()
      expect('tax_identity' in (piiRow ?? {})).toBe(true)
    })
  })

  // ── Cenário 2 — editar agendamento não driva a order [critical] ─────────────
  // Contrato 0027 (frente B, #1037): a order value-copia o snapshot do
  // appointment no momento do uso (startAttendance). Mutar o appointment DEPOIS
  // não retroage no OrderItem imutável. Versão leve da prova exaustiva em
  // appointment-snapshot.spec.ts; aqui fechamos a order e conferimos a comissão.
  test.describe('Cenário 2 — editar agendamento não driva a order', () => {
    test.use({
      orgInput: { unitCount: 1, memberOperationCount: 1, slotMinutes: 30, hasBusinessHours: true },
    })

    test('order fechada usa snapshot travado, não o appointment driftado', async ({
      org,
      authedPage,
    }) => {
      // P1 = R$ 50,00 / C1 = 50% → comissão travada = R$ 25,00.
      const serviceId = await seedService(org.orgId, {
        name: 'Corte DoD',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: org.unitIds,
      })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente DoD',
        whatsapp: uniqueWhatsapp(),
      })
      const appointmentId = await seedAppointment({
        orgId: org.orgId,
        unitId: org.unitIds[0]!,
        memberOperationId: org.memberOperationIds[0]!,
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
      await patchAppointmentSnapshot(org.orgId, appointmentId, {
        servicePriceCentsSnapshot: 99900,
        commissionSnapshot: { kind: 'percentage', value: 10 },
      })
      // O appointment realmente driftou (sanity) — mas a order não deve seguir.
      // A projeção tipada `appointments` no Postgres expõe o snapshot em
      // `service_price_cents_snapshot` (bigint → string no driver pg).
      const drifted = await pgReadProjection(
        'appointments',
        aggregateRef(AppointmentConfig, org.orgId, appointmentId),
      )
      expect(drifted?.service_price_cents_snapshot).toBe('99900')

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
  // commit, não a `cancellationPolicy` viva da unidade. Uma policy viva relaxada
  // NÃO destrava o cancelamento congelado sob policy estrita.
  test('Cenário 3 — elegibilidade segue o snapshot, não a policy viva', async ({
    context,
    page,
    baseURL,
  }) => {
    // A policy VIVA da unidade já nasce RELAXADA (disabled @ 0 min) — o trap do
    // #1038: se o read-site lesse a policy viva, o botão destravaria. O snapshot
    // do appointment congela a policy ESTRITA (enabled @ 120 min) do commit;
    // appointment 30 min à frente → dentro da janela estrita → bloqueado.
    const seed = await seedOrg({
      unitCount: 1,
      memberOperationCount: 1,
      cancellationPolicy: { enabled: false, minNoticeMinutes: 0 },
    })
    const serviceId = await seedService(seed.orgId, {
      name: 'Corte DoD Snapshot',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    // Cliente = identidade auth separada do owner (sessão de cliente exigida
    // pelo self-cancel). A shadow per-org liga o Customer ao User sem clobberar
    // o doc global do usuário.
    const customer = await seedAuthUser()
    const customerId = await seedCustomerShadowForUser(seed.orgId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    await seedAppointment({
      orgId: seed.orgId,
      unitId: seed.unitIds[0]!,
      memberOperationId: seed.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
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
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

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

// Feature-level E2E — parent #1054 (epic 0030 "Venda multi-vertical").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–4 + baseline), NOT the granular per-AC
// coverage the sub-issue specs already prove exhaustively against the emulator:
//   - orders/standalone-sale.spec.ts            (#1055 · AC-01/02 — venda
//     avulsa, cliente opcional, regressão agendamento)
//   - orders/member-attribution.spec.ts         (#1056 · AC-04/05 — atribuição
//     por membro, default esperto, recepção sem Professional fecha)
//   - orders/member-attribution-commission.spec.ts (#1057 · AC-06/07 — comissão
//     chaveada por membro, agrupada em /reports/commissions)
//   - orders/venda-terminology-pos.spec.ts      (#1058 · AC-09/10 — copy "Venda",
//     busca POS + steppers)
//
// Here we re-assert the SAME invariants stitched into the one journey the
// commerce/serviço operator lives, driving the FINAL UX after the 4 subs:
//   - venda avulsa nasce sem agendamento, sem cliente, atribuída ao membro que
//     abriu, fecha com pagamento real (dinheiro) e gera comissão pendente pro
//     membro quando o item tem regra;
//   - a comanda de serviço (caminho da agenda) segue intacta — nasce ligada ao
//     appointment, serviço default-atribuído ao profissional, cascatas como antes;
//   - todo item SEMPRE tem um membro atribuído, editável — nunca fecha venda com
//     item órfão; serviço-agendamento → profissional, produto/avulsa → operador;
//   - comissão de vendedor não-profissional (recepção) cai pro userId do membro,
//     aparece em /reports/commissions agrupada por membro, status pendente, sem
//     exigir identidade fiscal (liquidação manual, 0022);
//   - baseline: /orders (UI "Vendas") render + empty com CTA "Nova venda"; fluxo
//     real (criar → adicionar → atribuir → fechar → lista de fechadas); cancelar
//     venda aberta re-renderiza a lista; degenerado (sem cliente; produto sem
//     regra → atribuído, mas sem registro de comissão).
//
// Runs against the running emulator (no mocks). Seeds via the session helpers +
// Firestore REST admin bypass and reads order/commission state straight from
// Firestore to assert the stitched invariants.

import { liquidationStatusOf } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { type FsDocument, decodeFsListResponse, parseJson } from '../helpers/firestore-rest'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCatalogItem,
  seedCustomer,
  seedMember,
  seedProduct,
  seedService,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// --- Firestore REST readers (admin bypass via `Bearer owner`) ------------------
// The journeys read state straight from Firestore to assert invariants the UI
// only hints at (nullable customerId/appointmentId, per-item attributedUserId,
// commission key + liquidation status). These mirror the reference journeys'
// inline `seedMembership`/`readMembership` shape — list a org subcollection
// and decode the typed values we care about.

function listDocs(orgId: string, collection: string): readonly FsDocument[] {
  const out = execFileSync(
    'curl',
    ['-fsS', '-H', 'Authorization: Bearer owner', `${FS_BASE}/orgs/${orgId}/${collection}`],
    { encoding: 'utf8' },
  )
  const parsed = parseJson(out, decodeFsListResponse)
  return parsed.documents ?? []
}

type ReadOrder = {
  id: string
  status: string
  customerId: string | null
  appointmentId: string | null
  itemAttributions: (string | null)[]
}

function readOrders(orgId: string): ReadOrder[] {
  return listDocs(orgId, 'orders').map((doc) => {
    const f = doc.fields ?? {}
    const items = f.items?.arrayValue?.values ?? []
    return {
      id: doc.name?.split('/').pop() ?? '',
      status: f.status?.stringValue ?? '',
      customerId: f.customerId?.stringValue ?? null,
      appointmentId: f.appointmentId?.stringValue ?? null,
      itemAttributions: items.map(
        (it) => it.mapValue?.fields?.attributedUserId?.stringValue ?? null,
      ),
    }
  })
}

type ReadCommission = {
  attributedUserId: string | null
  liquidationStatus: string
  itemName: string | null
}

function readCommissions(orgId: string): ReadCommission[] {
  return listDocs(orgId, 'commissions').map((doc) => {
    const f = doc.fields ?? {}
    return {
      attributedUserId: f.attributedUserId?.stringValue ?? null,
      liquidationStatus: liquidationStatusOf({
        liquidationStatus: f.liquidationStatus?.stringValue,
      }),
      itemName: f.itemName?.stringValue ?? null,
    }
  })
}

// Closes the open sale via the WORKING payment path (cash) — never the broken
// `subscription` option (pre-existing bug in close-confirm-dialog.spec.ts).
async function closeWithCash(
  authedPage: Parameters<typeof addCatalogItemToOrder>[0],
): Promise<void> {
  await choosePaymentMethod(authedPage, 'cash')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Venda multi-vertical — DoD (#1054 · 0030)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  // Cenário 1 — venda avulsa de produto (varejo). Folds in the baseline:
  // render+empty (/orders "Vendas" with "Nova venda"), real flow (criar →
  // adicionar → atribuir → fechar → lista de fechadas) and the degenerate case
  // (sem cliente). On close, the commissionable product generates a PENDING
  // commission for the member who sold — no customer, no appointment, no pro.
  test.describe('Cenário 1 — venda avulsa de produto (varejo)', () => {
    test('/orders render+empty → cria avulsa, atribui ao operador, fecha com pagamento → fechada + comissão pendente; sem cliente/agendamento', async ({
      org,
      authedPage,
    }) => {
      // Produto comissionável (50% de R$ 30 = R$ 15) — comissiona o membro.
      seedCatalogItem(org.orgId, {
        kind: 'product',
        name: 'Cimento CP-II',
        priceCents: 3000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: [org.unitIds[0]!],
      })

      // Baseline render + empty: sem vendas na unidade → protagonist empty-state
      // (brief 0034), com o CTA único "Nova venda" (header escondido).
      await authedPage.goto('/orders')
      await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
      const novaVenda = authedPage.getByRole('button', { name: 'Nova venda' })
      await expect(novaVenda).toBeVisible()

      // Fluxo real: abre uma venda AVULSA (sem agendamento, sem cliente).
      await novaVenda.click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
      await expect(authedPage.getByText('agendamento vinculado')).toBeHidden()

      // Adiciona o produto: default-atribui ao operador (o owner que abriu).
      await addCatalogItemToOrder(authedPage, 'Cimento CP-II')
      const row = authedPage.getByRole('listitem').filter({ hasText: 'Cimento CP-II' })
      await expect(row).toBeVisible()
      await expect(row.getByRole('combobox', { name: 'Vendedor' })).toHaveText('E2E Owner')

      // Fecha pelo caminho que funciona (dinheiro) — nunca o `subscription` quebrado.
      await closeWithCash(authedPage)

      // Aparece na lista de fechadas rotulada como "Venda avulsa".
      await authedPage.goto('/orders?status=closed')
      await expect(authedPage.getByText('Venda avulsa').first()).toBeVisible()
      await expect(authedPage.getByText('Fechada', { exact: true }).first()).toBeVisible()

      // Invariantes lidos do Firestore: a venda fechou SEM cliente, SEM
      // agendamento, com o item atribuído ao operador.
      const order = readOrders(org.orgId).find((o) => o.status === 'closed')
      expect(order).toBeDefined()
      expect(order!.customerId).toBeNull()
      expect(order!.appointmentId).toBeNull()
      expect(order!.itemAttributions).toEqual([org.uid])

      // Comissão PENDENTE gerada pro membro que vendeu (o operador).
      const commissions = readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(org.uid)
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })

  // Cenário 2 — comanda de serviço segue intacta (caminho da agenda).
  // A venda nasce ligada ao appointment, o serviço default-atribuído ao
  // profissional, e o fechamento cascateia a comissão do serviço como antes.
  test.describe('Cenário 2 — comanda de serviço segue intacta', () => {
    test('agenda → iniciar atendimento → venda ligada ao appointment, serviço atribuído ao pro, fecha + cascata de comissão', async ({
      org,
      authedPage,
    }) => {
      const serviceId = seedService(org.orgId, {
        name: 'Corte Jornada',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 40 },
      })
      const customerId = seedCustomer(org.orgId, {
        name: 'Cliente Agendado',
        whatsapp: '11955554444',
      })
      seedAppointment({
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
        commissionSnapshot: { kind: 'percentage', value: 40 },
      })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: /Cliente Agendado/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

      // A venda nasce ligada ao appointment (carrega o cliente), NÃO é avulsa.
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByRole('heading', { name: 'Cliente Agendado' })).toBeVisible()
      await expect(authedPage.getByText('agendamento vinculado')).toBeVisible()

      // O serviço default-atribui ao profissional do agendamento (rótulo "Executor").
      const serviceRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Jornada' })
      await expect(serviceRow.getByRole('combobox', { name: 'Executor' })).toBeVisible()

      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`
      await closeWithCash(authedPage)

      // Invariantes: venda ligada ao appointment, com cliente, serviço atribuído
      // ao profissional; cascata gera a comissão dele.
      const order = readOrders(org.orgId).find((o) => o.status === 'closed')
      expect(order).toBeDefined()
      expect(order!.customerId).toBe(customerId)
      expect(order!.appointmentId).not.toBeNull()
      expect(order!.itemAttributions).toEqual([proUid])

      const commissions = readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(proUid)
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })

  // Cenário 3 — atribuição obrigatória com default (editável). Service-on-
  // appointment defaults to the pro; a product on the same sale defaults to the
  // opener; the product attribution is editable to another member. Every item
  // always carries an owner.
  test.describe('Cenário 3 — atribuição obrigatória com default', () => {
    test('serviço-agendamento → pro; produto → operador (editável p/ outro membro); todo item tem dono', async ({
      org,
      authedPage,
    }) => {
      const serviceId = seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 50 },
      })
      seedProduct(org.orgId, { name: 'Pomada', priceCents: 2000 })
      const gerente = seedMember(org.orgId, { role: 'manager', displayName: 'Gerente Loja' })
      const customerId = seedCustomer(org.orgId, {
        name: 'Cliente Default',
        whatsapp: '11955552222',
      })
      seedAppointment({
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

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: /Cliente Default/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      // Serviço-agendamento → default = profissional (rótulo "Executor").
      const serviceRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte' })
      await expect(serviceRow.getByRole('combobox', { name: 'Executor' })).toBeVisible()

      // Produto → default = operador que abriu (E2E Owner), depois editável.
      await addCatalogItemToOrder(authedPage, 'Pomada')
      const productSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Pomada' })
          .getByRole('combobox', { name: 'Vendedor' })
      await expect(productSeller()).toHaveText('E2E Owner')

      // Edita a atribuição do produto pra outro membro — sempre tem um dono.
      await productSeller().click()
      await authedPage.getByRole('option', { name: 'Gerente Loja' }).click()
      await expect(productSeller()).toHaveText('Gerente Loja')

      // Invariante: NENHUM item fica sem dono — serviço pro pro, produto pro gerente.
      const proUid = `e2e-prof-user-${org.professionalIds[0]!}`
      const order = readOrders(org.orgId).find((o) => o.appointmentId != null)
      expect(order).toBeDefined()
      expect(order!.itemAttributions).not.toContain(null)
      expect(order!.itemAttributions).toContain(proUid)
      expect(order!.itemAttributions).toContain(gerente.userId)
    })
  })

  // Cenário 4 — comissão pro vendedor não-profissional. A commissionable product
  // sold by a reception (no Professional) closes; the commission is keyed by the
  // member's userId and appears in /reports/commissions grouped by member,
  // status pending. Folds in the degenerate baseline: a product WITHOUT a
  // commission rule is attributed but generates NO commission, and the cancel
  // baseline (cancelling an open sale re-renders the list).
  test.describe('Cenário 4 — comissão pro vendedor não-profissional', () => {
    test('produto comissionável da recepção fecha → comissão por membro pendente em /reports/commissions; produto sem regra não comissiona; cancelar re-renderiza', async ({
      org,
      authedPage,
    }) => {
      // Produto comissionável (50% de R$ 30 = R$ 15) — comissiona qualquer membro.
      seedCatalogItem(org.orgId, {
        kind: 'product',
        name: 'Argamassa',
        priceCents: 3000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: [org.unitIds[0]!],
      })
      // Produto SEM regra (degenerado): atribuído mas não comissiona.
      seedProduct(org.orgId, { name: 'Prego Sem Comissao', priceCents: 1000 })
      // Recepção SEM Professional projection — o caso que a generalização destrava.
      const recepcao = seedMember(org.orgId, {
        role: 'receptionist',
        displayName: 'Recepção Balcão',
      })

      // Baseline cancelar: abre uma venda, cancela, a lista volta a renderizar.
      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      authedPage.on('dialog', (d) => d.accept())
      await authedPage.getByRole('button', { name: 'Cancelar venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders(\?.*)?$/)
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      // Venda de verdade: dois produtos atribuídos à recepção, um sem regra.
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      await addCatalogItemToOrder(authedPage, 'Argamassa')
      const argamassaSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Argamassa' })
          .getByRole('combobox', { name: 'Vendedor' })
      await argamassaSeller().click()
      await authedPage.getByRole('option', { name: 'Recepção Balcão' }).click()
      await expect(argamassaSeller()).toHaveText('Recepção Balcão')

      await addCatalogItemToOrder(authedPage, 'Prego Sem Comissao')
      const pregoSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Prego Sem Comissao' })
          .getByRole('combobox', { name: 'Vendedor' })
      await pregoSeller().click()
      await authedPage.getByRole('option', { name: 'Recepção Balcão' }).click()
      await expect(pregoSeller()).toHaveText('Recepção Balcão')

      // Fecha com dinheiro — não trava por falta de profissional aprovado (AC-05).
      await closeWithCash(authedPage)

      // Relatório agrupa POR MEMBRO: a recepção com a comissão pendente de R$ 15.
      await authedPage.goto('/reports/commissions')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
      const memberRow = authedPage.getByRole('row').filter({ hasText: 'Recepção Balcão' })
      await expect(memberRow).toBeVisible()
      await expect(memberRow.getByText('R$ 15,00').first()).toBeVisible()
      // O produto sem regra NÃO aparece como comissão.
      await expect(authedPage.getByText('Prego Sem Comissao')).toBeHidden()

      // Invariantes lidos do Firestore: ambos os produtos atribuídos à recepção;
      // SÓ uma comissão (do comissionável), chaveada pelo userId dela, pendente.
      const closed = readOrders(org.orgId).find((o) => o.status === 'closed')
      expect(closed).toBeDefined()
      expect(closed!.itemAttributions).toEqual([recepcao.userId, recepcao.userId])

      const commissions = readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(recepcao.userId)
      expect(commissions[0]!.itemName).toBe('Argamassa')
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })
})

'use server'

import {
  Appointment,
  CatalogItem,
  computeOrderTotals,
  StoredProfessional,
  type Order,
  type OrderCoverage,
  type OrderItem,
} from '@/domain'
import { OrderConfig } from '@/domain/aggregates'
import {
  parseItemForm,
  recalcAndPatch,
  snapshotCatalogItem,
} from '@/features/orders/core/order-helpers'
import { getAdminFirestore } from '@/shared/db'
import { formString } from '@/shared/form-data'
import { Effect } from 'effect'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { fsConverter } from '@/shared/db/converter'
import { emitEvent, emitEventGuarded } from '@/shared/effect-bridge'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { requireManagerCtx, requireOrgCtx } from '@/shared/org/membership'

import type { OrderMutationResult } from '@/features/orders/core/order-results'
import {
  assertMemberCanOperate,
  genItemId,
  loadOpenOrder,
  resolveItemCoverageSubscription,
} from './order-write-helpers'

export async function startAttendance(appointmentId: string): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)

  const apptSnap = await orgRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(appointmentId)
    .get()
  const appointment = apptSnap.data()
  if (!appointment) return { ok: false, error: 'Agendamento não encontrado' }

  if (appointment.status === 'cancelled') {
    return { ok: false, error: 'Agendamento cancelado — abra um novo' }
  }
  if (appointment.status === 'completed') {
    return { ok: false, error: 'Atendimento já concluído' }
  }
  if (appointment.status === 'no_show') {
    return { ok: false, error: 'Cliente marcado como ausente' }
  }

  // Idempotência: se já existe order aberta pra este agendamento, retorna
  // o ID dela em vez de criar outra. Evita duplo-click virar duas orders.
  const existing = await orgRef
    .collection('orders')
    .where('appointmentId', '==', appointmentId)
    .where('status', '==', 'open')
    .limit(1)
    .get()
  if (!existing.empty) {
    const existingId = existing.docs[0]!.id
    return { ok: true, orderId: existingId }
  }

  const [serviceSnap, profSnap] = await Promise.all([
    orgRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(appointment.serviceId)
      .get(),
    orgRef
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessional))
      .doc(appointment.professionalId)
      .get(),
  ])
  // Unified catalog read (brief 0023, #1004). Only id/name are pulled live —
  // the financial snapshot comes from the appointment, not the live item.
  const service = serviceSnap.data()
  if (!service) return { ok: false, error: 'Serviço do agendamento não encontrado' }
  const professional = profSnap.data()
  if (!professional) return { ok: false, error: 'Profissional do agendamento não encontrado' }

  // Snapshot-first: order inicial herda os valores que o appointment
  // gravou no commit (#875), não os live de Service. Owner mexer no
  // override depois do booking não retroage no histórico financeiro.
  const initialItem: OrderItem = {
    id: genItemId(),
    kind: 'service',
    refId: service.id,
    name: service.name,
    quantity: 1,
    unitPriceCents: appointment.servicePriceCentsSnapshot,
    commission: appointment.commissionSnapshot,
    // Atribuição por membro (brief 0030, AC-04): serviço de agendamento default
    // ao `userId` do profissional do appointment — NÃO o doc id de Professional.
    attributedUserId: professional.userId,
  }
  const totals = computeOrderTotals([initialItem], 0)

  const ref = orgRef.collection('orders').doc()
  const now = new Date().toISOString()
  const order: Order = {
    id: ref.id,
    orgId: r.ctx.membership.orgId,
    unitId: appointment.unitId,
    customerId: appointment.customerId,
    appointmentId,
    status: 'open',
    items: [initialItem],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: a comanda nasce de `order.created` carregando o snapshot
  // completo (a projeção escreve o doc — sem `ref.set` paralelo).
  const created = await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${ref.id}`, {
    _tag: 'order.created',
    actorId: r.ctx.session.uid,
    payload: { data: order },
  })
  if (!created.ok) return { ok: false, error: created.error }

  revalidatePath('/agenda')
  revalidatePath('/orders')
  return { ok: true, orderId: ref.id }
}

// Venda avulsa (brief 0030, AC-01): novo entrypoint que abre uma order SEM
// agendamento (`appointmentId: null`) e SEM cliente (`customerId: null`, AC-02).
// Espelha a emissão event-first do `startAttendance`, mas nasce vazia (sem item
// pré-populado) na unidade ativa do contexto (brief 0029). A atribuição de item
// por membro e o default de vendedor são da fatia seguinte (#1056) — aqui a
// venda só abre; os itens entram via `addItemToOrder`.
export async function createOrder(): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const { activeUnitId } = await resolveActiveUnit(r.ctx.membership)
  if (!activeUnitId) {
    return { ok: false, error: 'Nenhuma unidade ativa — crie uma unidade antes de vender' }
  }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const ref = orgRef.collection('orders').doc()
  const now = new Date().toISOString()
  const order: Order = {
    id: ref.id,
    orgId: r.ctx.membership.orgId,
    unitId: activeUnitId,
    // Venda anônima: sem cliente e sem agendamento (AC-01/AC-02).
    customerId: null,
    appointmentId: null,
    status: 'open',
    items: [],
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: 0,
    totalCents: 0,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: a venda nasce de `order.created` carregando o snapshot completo
  // (a projeção escreve o doc — sem `ref.set` paralelo). O snapshot generalizado
  // aceita `appointmentId: null` E `customerId: null` (brief 0030).
  const created = await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${ref.id}`, {
    _tag: 'order.created',
    actorId: r.ctx.session.uid,
    payload: { data: order },
  })
  if (!created.ok) return { ok: false, error: created.error }

  revalidatePath('/orders')
  return { ok: true, orderId: ref.id }
}

export async function addItemToOrder(
  orderId: string,
  formData: FormData,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const parsed = parseItemForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Default esperto da atribuição (brief 0030, AC-04): item sem `attributedUserId`
  // explícito fica atribuído ao membro que opera (o `userId` do ator). Cobre o
  // caso de varejo — produto avulso vendido pela recepção atribui à recepção.
  if (!parsed.attributedUserId) parsed.attributedUserId = r.ctx.session.uid

  const operateError = await assertMemberCanOperate({
    orgRef,
    orgId: r.ctx.membership.orgId,
    attributedUserId: parsed.attributedUserId,
    kind: parsed.kind,
    orderUnitId: loaded.order.unitId,
  })
  if (operateError) return { ok: false, error: operateError }

  // Guard transacional de descontinuação + preço (brief 0033 AC-08/AC-09): a
  // leitura da definição (catalog_item — ativo + preço) acontece DENTRO da
  // transação que appenda `order.item_added`, travando o doc. Concorrência
  // otimista do Firestore fecha a corrida "descontinua/reprecifica em T / vende
  // em T+δ": se a definição mudou entre o load e o commit, a tx re-tenta e
  // re-lê o estado fresco. Descontinuado → rejeita; preço = min(exibido, vigente).
  // É leitura de definição pra guardar/snapshotar o WRITE de UM aggregate (a
  // order) — não é saga cross-aggregate.
  const catalogPath = `orgs/${r.ctx.membership.orgId}/catalog_items/${parsed.refId}`
  const added = await emitEventGuarded({
    config: OrderConfig,
    aggregatePath: `orgs/${r.ctx.membership.orgId}/orders/${orderId}`,
    actorId: r.ctx.session.uid,
    tag: 'order.item_added',
    guard: (reader) =>
      Effect.gen(function* () {
        const item = yield* reader.getDoc(catalogPath, CatalogItem)
        const itemBase = snapshotCatalogItem(item, parsed, loaded.order.unitId)
        if (typeof itemBase === 'string') {
          return { _tag: 'reject' as const, message: itemBase }
        }
        const newItem: OrderItem = { id: genItemId(), ...itemBase }
        const items = [...loaded.order.items, newItem]
        const patch = recalcAndPatch(items, loaded.order.discountCents)
        return { _tag: 'ok' as const, payload: { changes: patch } }
      }),
  })
  if (!added.ok) return { ok: false, error: added.error }

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

export async function removeItemFromOrder(
  orderId: string,
  itemId: string,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const items = loaded.order.items.filter((it) => it.id !== itemId)
  if (items.length === loaded.order.items.length) {
    return { ok: false, error: 'Item não encontrado' }
  }
  if (items.length === 0) {
    return {
      ok: false,
      error: 'Venda precisa de pelo menos um item — cancele a venda em vez disso',
    }
  }

  const patch = recalcAndPatch(items, loaded.order.discountCents)
  // Event-first: `order.item_removed` carrega o patch recalculado.
  await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${orderId}`, {
    _tag: 'order.item_removed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

// Re-atribui um item a outro membro (brief 0030, AC-04). `attributedUserId` é o
// `userId` global do membro (não doc id de Professional). Valida que o membro
// pode operar (AC-05) com a trava por `kind` do item, e emite o evento renomeado
// `order.item_attribution_changed` carregando o patch recalculado.
export async function updateItemAttribution(
  orderId: string,
  itemId: string,
  attributedUserId: string,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }
  if (!attributedUserId.trim()) return { ok: false, error: 'Membro atribuído é obrigatório' }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const idx = loaded.order.items.findIndex((it) => it.id === itemId)
  if (idx < 0) return { ok: false, error: 'Item não encontrado' }
  const target = loaded.order.items[idx]!

  const operateError = await assertMemberCanOperate({
    orgRef,
    orgId: r.ctx.membership.orgId,
    attributedUserId,
    kind: target.kind,
    orderUnitId: loaded.order.unitId,
  })
  if (operateError) return { ok: false, error: operateError }

  const items = loaded.order.items.map((it, i) => (i === idx ? { ...it, attributedUserId } : it))
  const patch = recalcAndPatch(items, loaded.order.discountCents)
  // Event-first: `order.item_attribution_changed` carrega o patch recalculado.
  await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${orderId}`, {
    _tag: 'order.item_attribution_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function updateItemCoverage(
  orderId: string,
  itemId: string,
  coverage: OrderCoverage,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const idx = loaded.order.items.findIndex((it) => it.id === itemId)
  if (idx < 0) return { ok: false, error: 'Item não encontrado' }
  const target = loaded.order.items[idx]!

  let subscriptionId: string | null = null
  if (coverage === 'subscription') {
    const resolved = await resolveItemCoverageSubscription(orgRef, loaded.order, target, idx)
    if (typeof resolved === 'string') return { ok: false, error: resolved }
    subscriptionId = resolved.subscriptionId
  }

  const items = loaded.order.items.map((it, i) =>
    i === idx ? { ...it, coverage, subscriptionId } : it,
  )
  const patch = recalcAndPatch(items, loaded.order.discountCents)
  await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${orderId}`, {
    _tag: 'order.item_coverage_changed',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function updateOrderMeta(
  orderId: string,
  formData: FormData,
): Promise<OrderMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const discountStr = formString(formData, 'discount').trim()
  const discountCents = Math.round(Number(discountStr.replace(',', '.')) * 100)
  if (!Number.isFinite(discountCents) || discountCents < 0) {
    return { ok: false, error: 'Desconto inválido' }
  }
  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  const patch = recalcAndPatch(loaded.order.items, discountCents)
  // Event-first: `order.meta_updated` carrega o patch (desconto + totais).
  await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${orderId}`, {
    _tag: 'order.meta_updated',
    actorId: r.ctx.session.uid,
    payload: { changes: patch },
  })

  revalidatePath(`/orders/${orderId}`)
  return { ok: true, orderId }
}

export async function cancelOrder(orderId: string): Promise<OrderMutationResult> {
  // Cancelar é destrutivo (perde a venda) — restringe a owner/manager.
  const r = await requireManagerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const db = getAdminFirestore()
  const orgRef = db.collection('orgs').doc(r.ctx.membership.orgId)
  const loaded = await loadOpenOrder(orgRef, orderId)
  if (typeof loaded === 'string') return { ok: false, error: loaded }

  // Event-first: `order.cancelled` marca o status (a projeção escreve o doc).
  await emitEvent(OrderConfig, `orgs/${r.ctx.membership.orgId}/orders/${orderId}`, {
    _tag: 'order.cancelled',
    actorId: r.ctx.session.uid,
    payload: {},
  })
  revalidatePath(`/orders/${orderId}`)
  revalidatePath('/orders')
  return { ok: true, orderId }
}

// Venda avulsa (brief 0030, AC-01): o botão "Nova venda" em /orders dispara via
// `<form action>`. Mesmo padrão redirect-on-success do `startAttendanceFormAction`
// — sem `useActionState` (o marker NEXT_REDIRECT não cruza o boundary de state).
export async function createOrderFormAction(): Promise<void> {
  const res = await createOrder()
  if (!res.ok) throw new Error(res.error)
  redirect(`/orders/${res.orderId}`)
}

export async function startAttendanceFormAction(formData: FormData): Promise<void> {
  const raw = formData.get('appointmentId')
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Agendamento não informado')
  }
  const res = await startAttendance(raw)
  if (!res.ok) throw new Error(res.error)
  redirect(`/orders/${res.orderId}`)
}

import { isCatalogProduct, isCatalogService, isOrderEditable, Subscription } from '@/domain'
import {
  loadCommissionsForOrder,
  loadOrderById,
} from '@/features/orders/adapters/order-financial-read'
import type { OrderDetailProps } from '@/features/orders/ui/OrderDetail'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getCustomerById, listActiveCustomersForOrg } from '@/shared/org/customer-read'
import {
  getActiveOrgContext,
  hasMembershipCapability,
  listOrgMembers,
} from '@/shared/org/membership'
import { Schema } from 'effect'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

// The customer's ACTIVE subscription for this org (first match). Reads the typed
// projection under RLS. `null` when the customer has none.
async function loadActiveSubscription(
  orgId: string,
  customerId: string,
): Promise<Subscription | null> {
  const rows = await readUnderRls<SubscriptionRow>(orgId, (client) =>
    client
      .query<SubscriptionRow>(
        "SELECT * FROM subscriptions WHERE org_id = $1 AND customer_id = $2 AND status = 'active' LIMIT 1",
        [orgId, customerId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeSubscription(subscriptionRowToDoc(row)) : null
}

// Imperative shell for the order detail route: resolves session/org, loads
// the order plus its customer/catalog/members/commissions/active subscription,
// and returns the typed view-model `OrderDetail` consumes. The route component
// (page.tsx) stays a thin caller. `notFound()`/`redirect()` propagate from here
// just as they would inline during RSC render.
export async function loadOrderDetailPage(orderId: string): Promise<OrderDetailProps> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const order = await loadOrderById(ctx.membership.orgId, orderId)
  if (!order) notFound()

  const [customer, catalogItems, members, commissions, activeSub] = await Promise.all([
    // Não é um `*Snap` — `getCustomerById` já resolve o doc + faz join com
    // `users/` pra retornar o `Customer` enriched com PII. Venda avulsa (brief
    // 0030, AC-02) não tem cliente: `customerId` null → sem lookup.
    order.customerId
      ? getCustomerById(ctx.membership.orgId, order.customerId)
      : Promise.resolve(null),
    // Unified catalog (brief 0023, #1004): one read, split by kind below.
    listCatalogItems(ctx.membership.orgId, { activeOnly: true }),
    // Membros operáveis (brief 0030, AC-04): fonte do controle de atribuição por
    // membro — qualquer membro, não só MemberOperation. Atribui o `userId`.
    listOrgMembers(ctx.membership.orgId),
    // Comissões aparecem quando order está fechada — read-only.
    order.status === 'closed'
      ? loadCommissionsForOrder(ctx.membership.orgId, orderId)
      : Promise.resolve([]),
    // Assinatura ativa do cliente — base da cobertura por item (brief 0021).
    // Sem cliente (venda anônima) não há assinatura a consultar.
    order.customerId
      ? loadActiveSubscription(ctx.membership.orgId, order.customerId)
      : Promise.resolve(null),
  ])

  const services = catalogItems.filter(isCatalogService)
  const products = catalogItems.filter(isCatalogProduct)

  // Clientes ativos p/ o seletor da comanda avulsa (brief 0081) — só quando a
  // comanda ainda é editável (comanda fechada não vincula cliente). O gate do
  // cadastro inline espelha o `resolveCustomerIdForWrite` da action.
  const customers = isOrderEditable(order)
    ? await listActiveCustomersForOrg(ctx.membership.orgId)
    : []
  const canRegisterCustomer = hasMembershipCapability(ctx.membership, 'canManageCustomers')

  // Cobertura disponível: `remaining` é null pra plano ilimitado, ou saldo do
  // ciclo pra plano por contagem; null quando não há assinatura ativa.
  const subscriptionCoverage = activeSub
    ? {
        remaining:
          activeSub.plan.usageLimit.kind === 'count'
            ? Math.max(0, activeSub.plan.usageLimit.quantity - activeSub.currentPeriod.consumed)
            : null,
      }
    : null

  const canCancel = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'

  return {
    order,
    customer,
    services,
    products,
    members,
    currentUserId: session.uid,
    commissions,
    subscriptionCoverage,
    canCancel,
    customers,
    canRegisterCustomer,
  }
}

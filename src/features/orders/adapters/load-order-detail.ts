import { isCatalogProduct, isCatalogService, isOrderEditable, Subscription } from '@/domain'
import {
  loadCommissionsForOrder,
  loadOrderById,
} from '@/features/orders/adapters/order-financial-read'
import type { OrderDetailProps } from '@/features/orders/ui/OrderDetail'
import { getSessionUser } from '@/shared/auth/session'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import {
  rowToDoc as subscriptionRowToDoc,
  type SubscriptionRow,
} from '@/shared/db/pg/effect/subscription-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getCustomerById, listActiveCustomersForOrg } from '@/shared/org/customer-read'
import {
  getActiveOrgContext,
  hasMembershipCapability,
  listOrgMembers,
} from '@/shared/org/membership'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { Schema } from 'effect'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

const decodeSubscription = Schema.decodeUnknownSync(Subscription)

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

export async function loadOrderDetailPage(orderId: string): Promise<OrderDetailProps> {
  if (!isSupabaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const order = await loadOrderById(ctx.membership.orgId, orderId)
  if (!order) notFound()

  const [customer, catalogItems, members, commissions, activeSub] = await Promise.all([
    order.customerId
      ? getCustomerById(ctx.membership.orgId, order.customerId)
      : Promise.resolve(null),
    listCatalogItems(ctx.membership.orgId, { activeOnly: true }),
    listOrgMembers(ctx.membership.orgId),
    order.status === 'closed'
      ? loadCommissionsForOrder(ctx.membership.orgId, orderId)
      : Promise.resolve([]),
    order.customerId
      ? loadActiveSubscription(ctx.membership.orgId, order.customerId)
      : Promise.resolve(null),
  ])

  const services = catalogItems.filter(isCatalogService)
  const products = catalogItems.filter(isCatalogProduct)

  const customers = isOrderEditable(order)
    ? await listActiveCustomersForOrg(ctx.membership.orgId)
    : []
  const canRegisterCustomer = hasMembershipCapability(ctx.membership, 'canManageCustomers')

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

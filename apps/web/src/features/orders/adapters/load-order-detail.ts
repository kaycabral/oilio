import {
  CatalogItem,
  catalogProductToProduct,
  catalogServiceToService,
  Commission,
  isCatalogProduct,
  isCatalogService,
  Order,
  Subscription,
} from '@/domain'
import type { OrderDetailProps } from '@/features/orders/ui/OrderDetail'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getCustomerById } from '@/shared/org/customer-read'
import { getActiveOrgContext, listOrgMembers } from '@/shared/org/membership'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

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

  const orgRef = getAdminFirestore().collection('orgs').doc(ctx.membership.orgId)
  const orderSnap = await orgRef
    .collection('orders')
    .withConverter(fsConverter(Order))
    .doc(orderId)
    .get()
  const order = orderSnap.data()
  if (!order) notFound()

  const [customer, catalogSnap, members, commissionsSnap, subsSnap] = await Promise.all([
    // Não é um `*Snap` — `getCustomerById` já resolve o doc + faz join com
    // `users/` pra retornar o `Customer` enriched com PII. Venda avulsa (brief
    // 0030, AC-02) não tem cliente: `customerId` null → sem lookup.
    order.customerId
      ? getCustomerById(ctx.membership.orgId, order.customerId)
      : Promise.resolve(null),
    // Unified catalog (brief 0023, #1004): one read, split by kind below.
    orgRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .where('active', '==', true)
      .orderBy('name')
      .get(),
    // Membros operáveis (brief 0030, AC-04): fonte do controle de atribuição por
    // membro — qualquer membro, não só Professional. Atribui o `userId`.
    listOrgMembers(ctx.membership.orgId),
    // Comissões aparecem quando order está fechada — read-only.
    order.status === 'closed'
      ? orgRef
          .collection('commissions')
          .withConverter(fsConverter(Commission))
          .where('orderId', '==', orderId)
          .get()
      : Promise.resolve(null),
    // Assinatura ativa do cliente — base da cobertura por item (brief 0021).
    // Sem cliente (venda anônima) não há assinatura a consultar.
    order.customerId
      ? orgRef
          .collection('subscriptions')
          .withConverter(fsConverter(Subscription))
          .where('customerId', '==', order.customerId)
          .where('status', '==', 'active')
          .limit(1)
          .get()
      : Promise.resolve(null),
  ])

  const catalogItems = catalogSnap.docs.map((d) => d.data())
  const services = catalogItems.filter(isCatalogService).map(catalogServiceToService)
  const products = catalogItems.filter(isCatalogProduct).map(catalogProductToProduct)
  const commissions = commissionsSnap ? commissionsSnap.docs.map((d) => d.data()) : []

  // Cobertura disponível: `remaining` é null pra plano ilimitado, ou saldo do
  // ciclo pra plano por contagem; null quando não há assinatura ativa.
  const activeSub = !subsSnap || subsSnap.empty ? null : subsSnap.docs[0]!.data()
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
  }
}

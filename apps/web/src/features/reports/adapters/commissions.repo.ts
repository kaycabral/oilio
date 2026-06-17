import { Commission, type LiquidationStatus, Order } from '@/domain'
import type { CashReportRange } from '@/features/cash/core/range'
import {
  type CommissionsSectionData,
  shapeCommissionsSection,
} from '@/features/reports/core/commissions'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listTenantMembers } from '@/shared/tenant/membership'
import 'server-only'

/**
 * Loads the Comissões section data for the reports hub. Reads members,
 * commissions and the period's closed orders, then delegates the unit-scoping,
 * filtering and name resolution to the pure core (`shapeCommissionsSection`).
 */
export async function loadCommissionsSectionData(args: {
  tenantId: string
  range: CashReportRange
  unitId: string | null
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
}): Promise<CommissionsSectionData> {
  const { tenantId, range, unitId, memberFilter, statusFilter } = args
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)

  const [members, commissionsSnap, closedOrdersSnap] = await Promise.all([
    listTenantMembers(tenantId),
    tenantRef
      .collection('commissions')
      .withConverter(fsConverter(Commission))
      .where('createdAt', '>=', range.fromIso)
      .where('createdAt', '<=', range.toIso)
      .orderBy('createdAt', 'asc')
      .get(),
    tenantRef
      .collection('orders')
      .withConverter(fsConverter(Order))
      .where('status', '==', 'closed')
      .where('closedAt', '>=', range.fromIso)
      .where('closedAt', '<=', range.toIso)
      .get(),
  ])

  return shapeCommissionsSection({
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    allCommissions: commissionsSnap.docs.map((d) => d.data()),
    allClosedOrders: closedOrdersSnap.docs.map((d) => d.data()),
    unitId,
    memberFilter,
    statusFilter,
  })
}

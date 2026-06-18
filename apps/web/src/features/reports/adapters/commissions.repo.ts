import { Commission, type LiquidationStatus, Order } from '@/domain'
import type { CashReportRange } from '@/features/cash/core/range'
import {
  type CommissionsSectionData,
  shapeCommissionsSection,
} from '@/features/reports/core/commissions'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listOrgMembers } from '@/shared/org/membership'
import 'server-only'

/**
 * Loads the Comissões section data for the reports hub. Reads members,
 * commissions and the period's closed orders, then delegates the unit-scoping,
 * filtering and name resolution to the pure core (`shapeCommissionsSection`).
 */
export async function loadCommissionsSectionData(args: {
  orgId: string
  range: CashReportRange
  unitId: string | null
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
}): Promise<CommissionsSectionData> {
  const { orgId, range, unitId, memberFilter, statusFilter } = args
  const orgRef = getAdminFirestore().collection('orgs').doc(orgId)

  const [members, commissionsSnap, closedOrdersSnap] = await Promise.all([
    listOrgMembers(orgId),
    orgRef
      .collection('commissions')
      .withConverter(fsConverter(Commission))
      .where('createdAt', '>=', range.fromIso)
      .where('createdAt', '<=', range.toIso)
      .orderBy('createdAt', 'asc')
      .get(),
    orgRef
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

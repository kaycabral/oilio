import { Commission, type LiquidationStatus, Order } from '@/domain'
import type { CashReportRange } from '@/features/cash/core/range'
import {
  type CommissionsSectionData,
  shapeCommissionsSection,
} from '@/features/reports/core/commissions'
import {
  type CommissionRow,
  rowToDoc as commissionRowToDoc,
} from '@/shared/db/pg/effect/commission-projector'
import { type OrderRow, rowToDoc as orderRowToDoc } from '@/shared/db/pg/effect/order-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { listOrgMembers } from '@/shared/org/membership'
import { Schema } from 'effect'
import 'server-only'

const decodeCommission = Schema.decodeUnknownSync(Commission)
const decodeOrder = Schema.decodeUnknownSync(Order)

async function loadCommissionsInWindow(
  orgId: string,
  range: CashReportRange,
): Promise<Commission[]> {
  const rows = await readUnderRls<CommissionRow>(orgId, (client) =>
    client
      .query<CommissionRow>(
        `SELECT * FROM commissions
           WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3
           ORDER BY created_at ASC`,
        [orgId, range.fromIso, range.toIso],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCommission(commissionRowToDoc(r)))
}

async function loadClosedOrdersInWindow(orgId: string, range: CashReportRange): Promise<Order[]> {
  const rows = await readUnderRls<OrderRow>(orgId, (client) =>
    client
      .query<OrderRow>(
        `SELECT * FROM orders
           WHERE org_id = $1 AND status = 'closed'
             AND closed_at >= $2 AND closed_at <= $3`,
        [orgId, range.fromIso, range.toIso],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeOrder(orderRowToDoc(r)))
}

export async function loadCommissionsSectionData(args: {
  orgId: string
  range: CashReportRange
  unitId: string | null
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
}): Promise<CommissionsSectionData> {
  const { orgId, range, unitId, memberFilter, statusFilter } = args

  const [members, allCommissions, allClosedOrders] = await Promise.all([
    listOrgMembers(orgId),
    loadCommissionsInWindow(orgId, range),
    loadClosedOrdersInWindow(orgId, range),
  ])

  return shapeCommissionsSection({
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    allCommissions,
    allClosedOrders,
    unitId,
    memberFilter,
    statusFilter,
  })
}

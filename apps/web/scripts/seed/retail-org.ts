// A simple retail org (Pizzaria, Comércio): 1 fixed-hours unit with no agenda,
// a handful of products, customers, and closed sales. Used to prove multi-org
// ISOLATION — each retail org is fully self-contained under its own orgId, and
// no read/write crosses orgs (the RLS GUC is derived per-write from the ref).
//
// Built from the same primitives as the rich org; the retail shape just omits
// services / appointments / subscriptions.

import {
  agendaFixed,
  buildAddress,
  buildOrderItem,
  buildOrg,
  buildProductItem,
  buildUnit,
} from '@/shared/fixtures/seed-domain-builders'
import { ensureAuthIdentity } from './auth'
import { seedClosedSale } from './closed-sale'
import { seedCatalogItem, seedCustomer, seedOrgWithOwner, seedUnit } from './org-base'
import { now } from './runtime'

export interface RetailProduct {
  id: string
  name: string
  priceCents: number
  stock: number
}

export interface RetailSale {
  orderId: string
  customerId: string
  // refIds into the org's products; each becomes a non-commissioned line item.
  productIds: string[]
}

export interface RetailOrgSpec {
  orgId: string
  orgName: string
  slug: string
  owner: { uid: string; email: string; displayName: string; whatsapp: string; login: boolean }
  unitId: string
  unitName: string
  products: RetailProduct[]
  customerCount: number
  // Per-org base for generated customer WhatsApp numbers. `users.whatsapp` is
  // GLOBALLY unique (index `users_whatsapp_unique`), so two retail orgs seeded by
  // this same helper MUST NOT share a range — each caller passes a disjoint base.
  customerWhatsappBase: number
  sales: RetailSale[]
}

export async function seedRetailOrg(spec: RetailOrgSpec): Promise<void> {
  const { orgId, owner } = spec

  if (owner.login) {
    await ensureAuthIdentity({ uid: owner.uid, email: owner.email, displayName: owner.displayName })
  }
  await seedOrgWithOwner({
    org: buildOrg(orgId, owner.uid, now, {
      name: spec.orgName,
      slug: spec.slug,
      vertical: 'other',
    }),
    owner: { uid: owner.uid, displayName: owner.displayName, whatsapp: owner.whatsapp },
    now,
  })

  // Fixed-hours unit (retail / walk-in): no online agenda.
  await seedUnit(
    buildUnit(spec.unitId, orgId, now, {
      name: spec.unitName,
      slug: spec.unitId,
      address: buildAddress({ neighborhood: 'Centro', street: 'Rua do Comércio' }),
      agenda: agendaFixed(),
    }),
    owner.uid,
  )

  const productById = new Map<string, RetailProduct>()
  for (const p of spec.products) {
    productById.set(p.id, p)
    await seedCatalogItem(
      buildProductItem(p.id, orgId, now, {
        name: p.name,
        priceCents: p.priceCents,
        stock: p.stock,
        unitIds: [spec.unitId],
      }),
      owner.uid,
    )
  }

  for (let i = 0; i < spec.customerCount; i++) {
    await seedCustomer({
      id: `${orgId}-cust-${i}`,
      orgId,
      userId: `${orgId}-cust-${i}-user`,
      displayName: `Cliente ${i + 1}`,
      whatsapp: `55119${String(spec.customerWhatsappBase + i).padStart(8, '0')}`,
      birthDate: `198${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
      now,
      actorId: owner.uid,
    })
  }

  for (const sale of spec.sales) {
    const items = sale.productIds.map((refId, idx) => {
      const p = productById.get(refId)
      if (!p) throw new Error(`retail sale ${sale.orderId} references unknown product ${refId}`)
      return buildOrderItem(`${sale.orderId}-oi-${idx}`, owner.uid, {
        kind: 'product',
        refId,
        name: p.name,
        unitPriceCents: p.priceCents,
        commission: null,
      })
    })
    await seedClosedSale({
      orderId: sale.orderId,
      orgId,
      unitId: spec.unitId,
      customerId: sale.customerId,
      items,
      paymentMethod: 'cash',
      recordedByUid: owner.uid,
      memberNames: { [owner.uid]: owner.displayName },
      now,
    })
  }
}

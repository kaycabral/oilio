// Shared Test Data Builders — part 2: the org/unit/catalog/plan/agenda/order/
// cash aggregates the dev seed needs (the originals in `domain-builders.ts`
// cover the scheduling read-models the E2E helpers use). Split out only to stay
// under the file-size gate; the contract is identical — pure, strongly-typed
// object construction from `@/domain`, so a field added to a domain type breaks
// the seed at compile time (zero drift). Each caller decides the id + transport.

import {
  // re-exported below so the seed imports every builder from one module
  buildPlanSnapshot as _buildPlanSnapshot,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_ORG_BRANDING,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_UNIT_TIMEZONE,
  DEFAULT_WHATSAPP_TEMPLATES,
  INFORMAL_UNIT_FISCAL,
  type Address,
  type AgendaBlock,
  type CashMovement,
  type CatalogProductItem,
  type CatalogServiceItem,
  type Category,
  type CommissionRule,
  type CompanyProfile,
  type StoredOrg,
  type StoredUnit,
  type SubscriptionPlan,
  type UnitAgendaConfig,
  type UnitFiscal,
} from '@/domain'
import type { OpenOrder, OrderItem } from '@/domain/types/order'

export const buildPlanSnapshot = _buildPlanSnapshot

// Org projection (`org.created`). The Org is a pure folder (PRD Identidade v2):
// name (= business name, not PII), slug, vertical, branding, owner. The owner's
// tax identity (CPF/CNPJ) is NOT here — it lives in the deletable PII doc.
export function buildOrg(
  id: string,
  ownerUserId: string,
  now: string,
  overrides: Partial<StoredOrg> = {},
): StoredOrg {
  const base: StoredOrg = {
    id,
    name: 'Org',
    slug: id,
    vertical: 'barbershop',
    ownerUserId,
    branding: { ...DEFAULT_ORG_BRANDING },
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Canonical agenda configs by hours mode (discriminated union — the agenda-only
// fields exist ONLY in the appointment variant, by construction). `fixed` and
// `appointment` open Mon–Fri 09:00–18:00. Realistic defaults a seeded unit needs.
// Fixed publish timestamp for seeded already-published units — a stable value
// keeps the seed idempotent (same re-run → same projection).
const PUBLISHED_AT = '2024-01-01T00:00:00.000Z'

const WEEKDAY_HOURS = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: null,
  sunday: null,
} as const

export function agendaFixed(): UnitAgendaConfig {
  return { mode: 'fixed', businessHours: { ...WEEKDAY_HOURS } }
}

export function agendaAlwaysOpen(): UnitAgendaConfig {
  return { mode: 'always_open' }
}

export function agendaAppointment(published = false): UnitAgendaConfig {
  return {
    mode: 'appointment',
    businessHours: { ...WEEKDAY_HOURS },
    slotMinutes: DEFAULT_SLOT_MINUTES,
    cancellationPolicy: { ...DEFAULT_CANCELLATION_POLICY },
    confirmationTemplates: { ...DEFAULT_WHATSAPP_TEMPLATES },
    selfBookingPublished: published,
    selfBookingPublishedAt: published ? PUBLISHED_AT : null,
  }
}

// A complete, publish-ready São Paulo address (passes `isAddressComplete`).
// Seeds that need a publicly-live unit use this instead of `EMPTY_ADDRESS` (the
// blank zero-value, which is NOT publish-ready). Override per scenario.
export function buildAddress(overrides: Partial<Address> = {}): Address {
  return {
    postalCode: '01310-100',
    state: 'SP',
    city: 'São Paulo',
    neighborhood: 'Bela Vista',
    street: 'Avenida Paulista',
    number: '1000',
    complement: null,
    ...overrides,
  }
}

// Unit projection (`unit.created`). PII contact channels (whatsapp/email) are
// omitted from `StoredUnit` by design — they ride the deletable `units_pii`
// sidecar. Defaults to an informal `appointment` unit (Mon–Fri hours); override
// `agenda`/`fiscal` for retail (`fixed`/`always_open`) or formalized units.
export function buildUnit(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<StoredUnit> = {},
): StoredUnit {
  const base: StoredUnit = {
    id,
    orgId,
    name: 'Unit',
    slug: id,
    // Default to a complete, publish-ready address (#1283 / brief 0078 AC-17):
    // `unit.created` now decodes the address as `CompleteAddress` and the DB has
    // `units_address_complete`, so the blank `EMPTY_ADDRESS` zero-value can no
    // longer be persisted. Pass an explicit `address` override for the rare
    // not-publishable scenario.
    address: buildAddress(),
    timezone: DEFAULT_UNIT_TIMEZONE,
    agenda: agendaAppointment(),
    archivedAt: null,
    fiscal: INFORMAL_UNIT_FISCAL,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// A formalized (PJ) unit fiscal identity — a `company` `UnitFiscal` carrying the
// establishment's CNPJ-14 + the public registry `CompanyProfile` (NON-PII) + the
// formalization boundary. The name-bearing fields (razão social / nome fantasia)
// stay OUT — they live in the deletable PII doc.
export function companyFiscal(
  taxId: string,
  formalizedAt: string,
  profileOverrides: Partial<CompanyProfile> = {},
): UnitFiscal {
  const companyProfile: CompanyProfile = {
    taxId,
    isMei: true,
    taxRegime: 'mei',
    primaryActivity: { code: '9602501', description: 'Cabeleireiros, manicure e pedicure' },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Empresário (Individual)',
    registrationStatus: 'ATIVA',
    shareCapital: 0,
    activityStartedAt: formalizedAt,
    ...profileOverrides,
  }
  return { kind: 'company', taxId, companyProfile, formalizedAt }
}

// Category (CRUD aggregate). Defaults to an active, uncategorized-visual
// category; override `icon`/`color` when the scenario needs them.
export function buildCategory(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<Category> = {},
): Category {
  const base: Category = {
    id,
    orgId,
    name: 'Categoria',
    icon: null,
    color: null,
    active: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

const DEFAULT_SERVICE_COMMISSION: CommissionRule = { kind: 'percentage', value: 50 }

// Catalog service item (`catalog_item.created`, kind `service`). The union's
// service branch carries `durationMinutes`/`requiredResources`; product-only
// fields are absent by construction. Defaults to a 30-min commissioned service.
export function buildServiceItem(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<CatalogServiceItem> = {},
): CatalogServiceItem {
  const base: CatalogServiceItem = {
    id,
    orgId,
    kind: 'service',
    name: 'Serviço',
    categoryId: null,
    priceCents: 4500,
    commission: DEFAULT_SERVICE_COMMISSION,
    unitIds: [],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    durationMinutes: 30,
    requiredResources: [],
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Catalog product item (`catalog_item.created`, kind `product`). The union's
// product branch carries `sku`/`stock`/`gtin14`; service-only fields are absent
// by construction. Defaults to a stocked, commission-less product.
export function buildProductItem(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<CatalogProductItem> = {},
): CatalogProductItem {
  const base: CatalogProductItem = {
    id,
    orgId,
    kind: 'product',
    name: 'Produto',
    categoryId: null,
    priceCents: 3500,
    commission: null,
    unitIds: [],
    unitOverrides: null,
    publicVisible: true,
    priceVisibility: 'visible',
    active: true,
    archivedAt: null,
    sku: null,
    stock: 50,
    gtin14: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Subscription plan definition (`subscription_plan.created`). Defaults to an
// active monthly unlimited plan; override `billingCycle`/`priceCents`/coverage
// for the quarterly/semiannual/annual variants. The plan is the DEFINITION —
// `buildPlanSnapshot` freezes it onto a subscription at use-time.
export function buildSubscriptionPlan(
  id: string,
  orgId: string,
  now: string,
  overrides: Partial<SubscriptionPlan> = {},
): SubscriptionPlan {
  const base: SubscriptionPlan = {
    id,
    orgId,
    name: 'Plano',
    description: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [],
    includedCategoryIds: [],
    usageLimit: { kind: 'unlimited' },
    active: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...overrides }
}

// Agenda block (`agenda_block.created`) — a discriminated union recurring/one_off
// where each branch NULLs the other branch's fields by construction (the schema
// forbids a mixed shape). One builder per branch keeps every produced block a
// legal union member without a cast.
type AgendaBlockOneOff = Extract<AgendaBlock, { kind: 'one_off' }>
type AgendaBlockRecurring = Extract<AgendaBlock, { kind: 'recurring' }>

// One-off block: a concrete UTC startAt/endAt range (e.g. a doctor's appointment
// tomorrow). weekday/open/close are null by construction.
export function buildAgendaBlockOneOff(args: {
  id: string
  orgId: string
  unitId: string
  startAt: string
  endAt: string
  now: string
  overrides?: Partial<AgendaBlockOneOff>
}): AgendaBlockOneOff {
  const base: AgendaBlockOneOff = {
    id: args.id,
    orgId: args.orgId,
    unitId: args.unitId,
    memberOperationId: null,
    reason: 'Bloqueio',
    kind: 'one_off',
    weekday: null,
    open: null,
    close: null,
    startAt: args.startAt,
    endAt: args.endAt,
    createdAt: args.now,
    updatedAt: args.now,
  }
  return { ...base, ...args.overrides }
}

// Recurring block: repeats weekly on `weekday` between `open`/`close` (HH:mm),
// e.g. a daily lunch break. startAt/endAt are null by construction.
export function buildAgendaBlockRecurring(args: {
  id: string
  orgId: string
  unitId: string
  weekday: AgendaBlockRecurring['weekday']
  open: string
  close: string
  now: string
  overrides?: Partial<AgendaBlockRecurring>
}): AgendaBlockRecurring {
  const base: AgendaBlockRecurring = {
    id: args.id,
    orgId: args.orgId,
    unitId: args.unitId,
    memberOperationId: null,
    reason: 'Almoço',
    kind: 'recurring',
    weekday: args.weekday,
    open: args.open,
    close: args.close,
    startAt: null,
    endAt: null,
    createdAt: args.now,
    updatedAt: args.now,
  }
  return { ...base, ...args.overrides }
}

// Order line item (snapshot-on-use): captures the catalog item's price +
// commission rule at the moment of sale, so a later catalog edit never retroacts.
// `attributedUserId` is the commission beneficiary (the service's memberOperation,
// or the member who rang up a product) — a global userId, not a memberOperation id.
export function buildOrderItem(
  id: string,
  attributedUserId: string,
  overrides: Partial<OrderItem> = {},
): OrderItem {
  const base: OrderItem = {
    id,
    kind: 'service',
    refId: 'item',
    name: 'Item',
    quantity: 1,
    unitPriceCents: 4500,
    commission: DEFAULT_SERVICE_COMMISSION,
    attributedUserId,
  }
  return { ...base, ...overrides }
}

// Open order (`order.created`). Every order is born open — typed as the concrete
// `OpenOrder` branch (not the union) so spreading preserves the correlation.
// Totals default to the sum of items unless overridden.
export function buildOpenOrder(args: {
  id: string
  orgId: string
  unitId: string
  customerId: string
  now: string
  overrides?: Partial<OpenOrder>
}): OpenOrder {
  const items: OrderItem[] = args.overrides?.items ?? []
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const base: OpenOrder = {
    id: args.id,
    orgId: args.orgId,
    unitId: args.unitId,
    customerId: args.customerId,
    appointmentId: null,
    status: 'open',
    items,
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents,
    totalCents: subtotalCents,
    createdAt: args.now,
    updatedAt: args.now,
  }
  return { ...base, ...args.overrides }
}

// Cash movement (`cash_movement.created`) — a union discriminated by `kind`,
// where each kind fixes its `direction` and which links may exist (the shape the
// DB CHECK mirrors). One builder per kind keeps every produced movement a legal
// union member by construction, without a cast. Shared fields are threaded once.
type CashMovementOf<K extends CashMovement['kind']> = Extract<CashMovement, { kind: K }>

export interface CashMovementCommon {
  id: string
  orgId: string
  unitId: string
  recordedByUid: string
  amountCents: number
  now: string
  description?: string | null
}

// `despesa` (cash-out, out of register): no order/payment link; an optional
// free-text `expenseCategoryId` (no FK) tags the expense.
export function buildExpenseMovement(
  common: CashMovementCommon,
  expenseCategoryId: string | null = null,
): CashMovementOf<'despesa'> {
  return {
    id: common.id,
    orgId: common.orgId,
    unitId: common.unitId,
    kind: 'despesa',
    direction: 'out',
    amountCents: common.amountCents,
    paymentMethod: null,
    description: common.description ?? null,
    orderId: null,
    expenseCategoryId,
    recordedByUid: common.recordedByUid,
    createdAt: common.now,
  }
}

// `sangria` (cash withdrawal, out): no links; direction fixed by kind.
export function buildSangriaMovement(common: CashMovementCommon): CashMovementOf<'sangria'> {
  return {
    id: common.id,
    orgId: common.orgId,
    unitId: common.unitId,
    kind: 'sangria',
    direction: 'out',
    amountCents: common.amountCents,
    paymentMethod: null,
    description: common.description ?? null,
    orderId: null,
    expenseCategoryId: null,
    recordedByUid: common.recordedByUid,
    createdAt: common.now,
  }
}

// `suprimento` (cash supply, in): no links; direction fixed by kind.
export function buildSuprimentoMovement(common: CashMovementCommon): CashMovementOf<'suprimento'> {
  return {
    id: common.id,
    orgId: common.orgId,
    unitId: common.unitId,
    kind: 'suprimento',
    direction: 'in',
    amountCents: common.amountCents,
    paymentMethod: null,
    description: common.description ?? null,
    orderId: null,
    expenseCategoryId: null,
    recordedByUid: common.recordedByUid,
    createdAt: common.now,
  }
}

// `sale` (cash-in from a closed order): carries the `orderId` link + the
// `paymentMethod`. The cash counterpart of `order.closed` in a sale cascade.
export function buildSaleMovement(
  common: CashMovementCommon,
  orderId: string,
  paymentMethod: CashMovementOf<'sale'>['paymentMethod'],
): CashMovementOf<'sale'> {
  return {
    id: common.id,
    orgId: common.orgId,
    unitId: common.unitId,
    kind: 'sale',
    direction: 'in',
    amountCents: common.amountCents,
    paymentMethod,
    description: common.description ?? null,
    orderId,
    expenseCategoryId: null,
    recordedByUid: common.recordedByUid,
    createdAt: common.now,
  }
}

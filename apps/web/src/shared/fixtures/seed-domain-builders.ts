import {
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

export function agendaAppointment(): UnitAgendaConfig {
  return {
    mode: 'appointment',
    businessHours: { ...WEEKDAY_HOURS },
    slotMinutes: DEFAULT_SLOT_MINUTES,
    cancellationPolicy: { ...DEFAULT_CANCELLATION_POLICY },
    confirmationTemplates: { ...DEFAULT_WHATSAPP_TEMPLATES },
  }
}

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
    unitIds: ['unit-seed'],
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
    unitIds: ['unit-seed'],
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

type AgendaBlockOneOff = Extract<AgendaBlock, { kind: 'one_off' }>
type AgendaBlockRecurring = Extract<AgendaBlock, { kind: 'recurring' }>

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

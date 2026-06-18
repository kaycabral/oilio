// Dev seed for the local emulator: a ready-to-use "Barbearia do Zé" org so
// manual testing survives an emulator restart (data is wiped on stop). See
// README § Scripts. Idempotent; additive — never touches other accounts.

import type {
  Address,
  AgendaBlock,
  Appointment,
  AppointmentStatus,
  BusinessHours,
  CashMovement,
  CatalogProductItem,
  CatalogServiceItem,
  Category,
  Commission,
  CommissionRule,
  CompanyProfile,
  ExpenseCategory,
  InvitePii,
  LiquidationStatus,
  Membership,
  Order,
  OrderItem,
  Org,
  OrgLink,
  PaymentMethod,
  Product,
  Service,
  StoredInvite,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlanSnapshot,
  Unit,
  UnitAgendaConfig,
  UnitFiscal,
  UnitHoursMode,
  User,
} from '@/domain'
import {
  accrueCommissionForItem,
  computeOrderTotals,
  defaultPermissionsForRole,
  fromOrgTime,
  getTodayInOrgTz,
  membershipDocId,
  orgLinkDocPath,
  resolveServiceForUnit,
  shiftDateInOrgTz,
} from '@/domain'
import {
  CashMovementConfig,
  CommissionConfig,
  deriveOperationalStatus,
  MembershipConfig,
  OrderConfig,
  ProfessionalConfig,
} from '@/domain/aggregates'
import { getAdminAuth, getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import type { ProfessionalPii, StoredProfessional } from '@/shared/org/professional-read'
import type { UnitPii } from '@/shared/org/unit-read'

// @/shared/db resolves the project id (fail-fast if missing) and auto-routes
// to the emulator from FIRESTORE_EMULATOR_HOST. `pnpm db:seed` provides both
// via .env.local.
const auth = getAdminAuth()
const db = getAdminFirestore()

function hasErrorCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code
}

const OWNER = {
  uid: 'seed-owner',
  email: 'dev@cbrl.local',
  displayName: 'Zé Owner',
  whatsapp: '5511999990000',
}

const ORG_ID = 'seed-org'
const ORG_SLUG = 'barbearia-do-ze'
const ORG_TZ = 'America/Sao_Paulo'
const NOW = new Date().toISOString()

const WEEKDAY_HOURS = [{ open: '09:00', close: '19:00' }]
const BUSINESS_HOURS: BusinessHours = {
  monday: WEEKDAY_HOURS,
  tuesday: WEEKDAY_HOURS,
  wednesday: WEEKDAY_HOURS,
  thursday: WEEKDAY_HOURS,
  friday: WEEKDAY_HOURS,
  saturday: { open: '09:00', close: '17:00' },
  sunday: null,
}

const UNITS = [
  {
    id: 'seed-unit-centro',
    name: 'Centro',
    slug: 'centro',
    whatsapp: '5511999990001',
    // SPIKE (inferred availability): appointment mode + hours → bookable.
    hoursMode: 'appointment' as const,
    // Real address so the unit satisfies the self-booking publish gate
    // (`getPublishingReadiness` requires address + business hours). Without it,
    // the force-published seed couldn't be re-published from the UI.
    address: {
      postalCode: '01310-100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
      number: '1000',
      complement: null,
    },
  },
  {
    id: 'seed-unit-zona-sul',
    name: 'Zona Sul',
    slug: 'zona-sul',
    whatsapp: '5511999990002',
    hoursMode: 'appointment' as const,
    address: {
      postalCode: '04547-130',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Vila Olímpia',
      street: 'Rua Funchal',
      number: '500',
      complement: null,
    },
  },
  {
    // Walk-in unit (no agenda) — exercises the `always_open` hours mode and the
    // multi-vertical nav signal (a org whose units aren't all appointment).
    id: 'seed-unit-expresso',
    name: 'Atendimento Expresso',
    slug: 'expresso',
    whatsapp: '5511999990003',
    hoursMode: 'always_open' as const,
    address: {
      postalCode: '01001-000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Sé',
      street: 'Praça da Sé',
      number: '100',
      complement: null,
    },
  },
] satisfies {
  id: string
  name: string
  slug: string
  whatsapp: string
  address: Address
  hoursMode: UnitHoursMode
}[]
const UNIT_IDS = UNITS.map((u) => u.id)

// Assemble the seed unit's `Unit.agenda` union by mode (PRD Identidade v2): the
// agenda-only configs (slot/policy/templates/self-booking publish) live ONLY in
// the appointment variant; the seed force-publishes it so the public page is
// live. always_open/fixed carry no agenda-only configs.
function buildSeedAgenda(mode: UnitHoursMode): UnitAgendaConfig {
  switch (mode) {
    case 'appointment':
      return {
        mode: 'appointment',
        businessHours: BUSINESS_HOURS,
        slotMinutes: 30,
        cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
        selfBookingPublished: true,
        selfBookingPublishedAt: NOW,
      }
    case 'always_open':
      return { mode: 'always_open' }
    case 'fixed':
      return { mode: 'fixed', businessHours: BUSINESS_HOURS }
  }
}

const COMMISSION: CommissionRule = { kind: 'percentage', value: 40 }

// Catalog category entity (brief 0023, #1003). The plan's `includedCategoryIds`
// and every catalog item's `categoryId` are FKs into this id.
const CATEGORY_ID = 'seed-cat-cabelo'

const SERVICES = [
  {
    id: 'seed-svc-corte',
    name: 'Corte',
    category: 'Cabelo',
    durationMinutes: 30,
    priceCents: 4500,
  },
  { id: 'seed-svc-barba', name: 'Barba', category: 'Barba', durationMinutes: 30, priceCents: 3000 },
  {
    id: 'seed-svc-combo',
    name: 'Corte + Barba',
    category: 'Combo',
    durationMinutes: 60,
    priceCents: 7000,
  },
  {
    id: 'seed-svc-sobrancelha',
    name: 'Sobrancelha',
    category: 'Estética',
    durationMinutes: 15,
    priceCents: 2000,
  },
]
const SERVICE_IDS = SERVICES.map((s) => s.id)
const SERVICE_DOCS: Service[] = SERVICES.map((s) => ({
  id: s.id,
  orgId: ORG_ID,
  name: s.name,
  category: s.category,
  durationMinutes: s.durationMinutes,
  priceCents: s.priceCents,
  commission: COMMISSION,
  requiredResources: [],
  active: true,
  publicVisible: true,
  priceVisibility: 'visible',
  unitIds: UNIT_IDS,
  unitOverrides: null,
  createdAt: NOW,
  updatedAt: NOW,
}))

// Unified catalog items (brief 0023, #1004). Consumers (agenda/booking/order/
// public catalog) read from `catalog_items` discriminated by `kind`. Services
// mirror SERVICE_DOCS 1:1 (same ids, so historical appointments/orders that
// reference `serviceId` resolve); products mirror PRODUCTS. `categoryId` is the
// real FK into the seeded category (all under "Cabelo" for the demo org).
const CATALOG_SERVICE_DOCS: CatalogServiceItem[] = SERVICE_DOCS.map((s) => ({
  id: s.id,
  orgId: ORG_ID,
  kind: 'service',
  name: s.name,
  categoryId: CATEGORY_ID,
  priceCents: s.priceCents,
  commission: COMMISSION,
  unitIds: UNIT_IDS,
  unitOverrides: null,
  publicVisible: true,
  priceVisibility: 'visible',
  active: true,
  archivedAt: null,
  durationMinutes: s.durationMinutes,
  requiredResources: [],
  createdAt: NOW,
  updatedAt: NOW,
}))

// Seed professionals in the new model (brief 0028, #1048 / AC-09). Each pro is
// born exactly like the invite-accept saga does it (#1045): a global User doc
// (identity source of truth — name/whatsapp/email read LIVE from there, #1046),
// a `membership` with role=professional, and the Professional projection that
// materializes from `professional.created` (operational fields + non-null
// `userId`, NO denormalized identity — ADR 0010 keeps PII out of the event).
// `operationalStatus` is DERIVED (#1047), never hardcoded: the seed emits
// `professional.activated` only because the derivation rule is met (User has
// whatsapp ∧ ≥1 unit ∧ ≥1 service) — same event path as `reconcileOperational`.
const PROFESSIONALS = [
  {
    id: 'seed-prof-ze',
    userId: 'seed-user-prof-ze',
    name: 'Zé',
    whatsapp: '5511999990000',
    email: 'ze@cbrl.local',
    birthDate: '1990-07-22',
  },
  {
    id: 'seed-prof-maria',
    userId: 'seed-user-prof-maria',
    name: 'Maria',
    whatsapp: '5511988880001',
    email: 'maria@cbrl.local',
    birthDate: '1992-11-05',
  },
  {
    id: 'seed-prof-joao',
    userId: 'seed-user-prof-joao',
    name: 'João',
    whatsapp: '5511988880002',
    email: 'joao@cbrl.local',
    birthDate: '1988-02-18',
  },
  {
    // Incomplete profile (no whatsapp) → derivation yields a NON-approved
    // professional, so the team shows the "aguardando aprovação" state.
    id: 'seed-prof-novo',
    userId: 'seed-user-prof-novo',
    name: 'Novo Profissional',
    whatsapp: '',
    email: 'novo.prof@cbrl.local',
    // Incomplete: no birthDate either (completion sets whatsapp ∧ birthDate
    // together), so this stays a coherent pre-completion state.
    birthDate: null,
  },
]

// Non-professional seller (brief 0030, AC-05): the receptionist sells
// commissionable retail at the counter — no Professional projection, just an
// active membership. Demonstrates by-member commission (Comissões) for a member
// who is not a professional. Born like any member: global User + Membership.
const RECEPTIONIST = {
  userId: 'seed-user-recep',
  name: 'Paula Recepção',
  whatsapp: '5511988880003',
  email: 'paula@cbrl.local',
  birthDate: '1995-09-30',
}

// birthDate uses this month so the "aniversariantes" surfaces have data; the
// first customer's birthday is TODAY so the birthday marker is visible.
const today = getTodayInOrgTz(ORG_TZ)
const thisMonth = today.slice(5, 7)
const thisDay = today.slice(8, 10)

// ── Demo data generators ───────────────────────────────────────────────────
// Volume + variety on top of the curated edge-case rows below, so every list is
// long enough to test pagination/scroll and every status/variant is present.
const pad2 = (n: number): string => String(n).padStart(2, '0')

const DEMO_FIRST = [
  'Lucas',
  'Mariana',
  'Pedro',
  'Julia',
  'Rafael',
  'Beatriz',
  'Gustavo',
  'Larissa',
  'Felipe',
  'Camila',
  'Rodrigo',
  'Fernanda',
  'Thiago',
  'Patricia',
  'Andre',
  'Leticia',
  'Marcelo',
  'Vanessa',
  'Diego',
  'Aline',
  'Henrique',
  'Tatiane',
  'Vinicius',
  'Priscila',
  'Eduardo',
  'Sabrina',
  'Ricardo',
  'Carolina',
  'Leonardo',
  'Natalia',
  'Gabriel',
  'Renata',
  'Matheus',
  'Bianca',
  'Caio',
  'Debora',
]
const DEMO_LAST = [
  'Oliveira',
  'Santos',
  'Pereira',
  'Costa',
  'Rodrigues',
  'Almeida',
  'Nascimento',
  'Carvalho',
  'Gomes',
  'Martins',
  'Araujo',
  'Ribeiro',
  'Barbosa',
  'Rocha',
  'Dias',
]

// Birthday variety so the list exercises every branch of the birthday indicator:
// today, later this month, other months, and "no date on file".
function demoBirthDate(i: number): string | null {
  const year = 1980 + (i % 25)
  switch (i % 5) {
    // Birthday is today.
    case 0:
      return `${year}-${thisMonth}-${thisDay}`
    // Later this month.
    case 1:
      return `${year}-${thisMonth}-${pad2(((Number(thisDay) + 3) % 27) + 1)}`
    // No date on file.
    case 2:
      return null
    // Some other month.
    default:
      return `${year}-${pad2((i % 12) + 1)}-${pad2((i % 27) + 1)}`
  }
}

function buildDemoCustomers() {
  return DEMO_FIRST.map((first, i) => {
    const last = DEMO_LAST[i % DEMO_LAST.length] ?? 'Silva'
    const n = i + 1
    return {
      id: `seed-cust-g${n}`,
      userId: `seed-user-cg${n}`,
      name: `${first} ${last}`,
      whatsapp: `5511${String(900000000 + n)}`,
      email: i % 4 === 0 ? null : `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      birthDate: demoBirthDate(i),
      avatarUrl: i % 5 === 0 ? `https://i.pravatar.cc/120?img=${(i % 70) + 1}` : null,
    }
  })
}

const CUSTOMERS = [
  {
    id: 'seed-cust-1',
    userId: 'seed-user-c1',
    name: 'Carlos Silva',
    whatsapp: '5511970000001',
    email: 'carlos@example.com',
    // Birthday today → shows the birthday indicator in the list.
    birthDate: `1990-${thisMonth}-${thisDay}`,
    avatarUrl: null,
  },
  {
    id: 'seed-cust-2',
    userId: 'seed-user-c2',
    name: 'Ana Souza',
    whatsapp: '5511970000002',
    email: 'ana@example.com',
    birthDate: `1985-${thisMonth}-25`,
    // A real photo → exercises the avatar image path (others fall back to a
    // monogram).
    avatarUrl: 'https://i.pravatar.cc/120?img=47',
  },
  {
    id: 'seed-cust-3',
    userId: 'seed-user-c3',
    name: 'Bruno Lima',
    whatsapp: '5511970000003',
    email: null,
    birthDate: '1995-07-08',
    avatarUrl: null,
  },
  {
    id: 'seed-cust-4',
    userId: 'seed-user-c4',
    name: 'Daniela Castro',
    whatsapp: '5511970000004',
    email: 'daniela@example.com',
    // No birth date on file → no birthday marker ever.
    birthDate: null,
    avatarUrl: null,
  },
  ...buildDemoCustomers(),
]

const PRODUCTS = [
  { id: 'seed-prod-pomada', name: 'Pomada Modeladora', priceCents: 3500, stock: 40 },
  { id: 'seed-prod-shampoo', name: 'Shampoo Anticaspa', priceCents: 2800, stock: 25 },
]

const CATALOG_PRODUCT_DOCS: CatalogProductItem[] = PRODUCTS.map((p) => ({
  id: p.id,
  orgId: ORG_ID,
  kind: 'product',
  name: p.name,
  categoryId: CATEGORY_ID,
  priceCents: p.priceCents,
  commission: null,
  unitIds: UNIT_IDS,
  unitOverrides: null,
  // One public product so the landing exercises the `publicVisible` branch
  // (AC-08); the other stays internal-only.
  publicVisible: p.id === 'seed-prod-pomada',
  priceVisibility: 'visible',
  // One inactive product so the catalog shows the "Inativo" badge.
  active: p.id !== 'seed-prod-shampoo',
  archivedAt: null,
  sku: null,
  stock: p.stock,
  createdAt: NOW,
  updatedAt: NOW,
}))

const PLAN_ID = 'seed-plan-mensal'

// Subscription plans covering every axis brief 0019/0024 exposes: billing cycle,
// per-item vs per-category coverage, usage limit (unlimited vs count), unit
// allowlist, time scope (weekday/hour/advance), booking limits, and an archived
// plan. Reused as the source of truth for both the plan docs and the snapshots
// frozen onto subscriptions (no drift).
const PLAN_VARIANTS: SubscriptionPlan[] = [
  {
    id: 'seed-plan-trimestral',
    orgId: ORG_ID,
    name: 'Plano Trimestral — Corte & Barba',
    description: 'Corte e barba inclusos, cobrança a cada 3 meses.',
    priceCents: 24000,
    billingCycle: 'quarterly',
    includedItemIds: ['seed-svc-corte', 'seed-svc-barba'],
    includedCategoryIds: [],
    usageLimit: { kind: 'count', quantity: 8 },
    unitAllowlist: ['seed-unit-centro'],
    active: true,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'seed-plan-anual-estetica',
    orgId: ORG_ID,
    name: 'Plano Anual — Estética',
    description: 'Categoria Estética liberada, horários de semana pela manhã.',
    priceCents: 80000,
    billingCycle: 'annual',
    includedItemIds: [],
    includedCategoryIds: ['seed-cat-estetica'],
    usageLimit: { kind: 'unlimited' },
    allowedTimeScope: {
      daysOfWeek: [1, 2, 3, 4, 5],
      hourRange: { start: '09:00', end: '12:00' },
      advanceBookingDays: 14,
    },
    active: true,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'seed-plan-semestral-limites',
    orgId: ORG_ID,
    name: 'Plano Semestral — com limites',
    description: 'Um agendamento por dia, máximo 2 simultâneos.',
    priceCents: 42000,
    billingCycle: 'semiannual',
    includedItemIds: ['seed-svc-corte', 'seed-svc-degrade'],
    includedCategoryIds: [],
    usageLimit: { kind: 'count', quantity: 12 },
    bookingLimits: { maxPerDay: 1, maxConcurrent: 2, requireCompleteBeforeNext: true },
    active: true,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'seed-plan-arquivado',
    orgId: ORG_ID,
    name: 'Plano Antigo (arquivado)',
    description: 'Plano descontinuado — não aparece no picker de novos.',
    priceCents: 7000,
    billingCycle: 'monthly',
    includedItemIds: ['seed-svc-corte'],
    includedCategoryIds: [],
    usageLimit: { kind: 'count', quantity: 4 },
    active: false,
    archivedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

// Freeze a plan into the snapshot stored on a Subscription (brief 0019/0024).
function planToSnapshot(plan: SubscriptionPlan): SubscriptionPlanSnapshot {
  const snapshot: SubscriptionPlanSnapshot = {
    planId: plan.id,
    name: plan.name,
    priceCents: plan.priceCents,
    billingCycle: plan.billingCycle,
    includedItemIds: [...plan.includedItemIds],
    includedCategoryIds: [...plan.includedCategoryIds],
    usageLimit: plan.usageLimit,
  }
  if (plan.unitAllowlist) snapshot.unitAllowlist = [...plan.unitAllowlist]
  if (plan.allowedTimeScope) snapshot.allowedTimeScope = plan.allowedTimeScope
  if (plan.bookingLimits) snapshot.bookingLimits = plan.bookingLimits
  return snapshot
}

// Login is OAuth-only, so the owner needs a linked google.com identity to show
// in the emulator's Google account-picker. Skip if it already exists so a
// re-seed keeps an open session valid instead of invalidating it.
async function ensureOwnerAuth(): Promise<void> {
  try {
    await auth.getUser(OWNER.uid)
    return
  } catch (err: unknown) {
    if (!hasErrorCode(err, 'auth/user-not-found')) throw err
  }
  const result = await auth.importUsers([
    {
      uid: OWNER.uid,
      email: OWNER.email,
      emailVerified: true,
      displayName: OWNER.displayName,
      providerData: [
        {
          uid: OWNER.email,
          providerId: 'google.com',
          email: OWNER.email,
          displayName: OWNER.displayName,
        },
      ],
    },
  ])
  if (result.failureCount > 0) {
    throw new Error(`importUsers failed: ${result.errors.map((e) => e.error.message).join('; ')}`)
  }
}

async function seed(): Promise<void> {
  await ensureOwnerAuth()

  const batch = db.batch()
  const orgRef = db.collection('orgs').doc(ORG_ID)
  const ref = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  const today = getTodayInOrgTz(ORG_TZ)
  const yesterday = shiftDateInOrgTz(today, -1, ORG_TZ)
  const tomorrow = shiftDateInOrgTz(today, 1, ORG_TZ)

  batch.set(orgRef, {
    id: ORG_ID,
    name: 'Barbearia do Zé',
    slug: ORG_SLUG,
    vertical: 'barbershop',
    // The Org is a pure folder (PRD Identidade v2) — no fiscal identity (CNPJ on
    // Unit.fiscal) and no agenda/self-booking config (timezone, slot,
    // cancellation, confirmation messages, self-booking publish all on
    // Unit.agenda). Barbearia do Zé's units stay informal.
    ownerUserId: OWNER.uid,
    branding: { logoUrl: null, bannerUrl: null, description: 'Cortes clássicos e barba na régua.' },
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies Org)

  const membershipId = membershipDocId(ORG_ID, OWNER.uid)
  batch.set(db.collection('memberships').doc(membershipId), {
    id: membershipId,
    orgId: ORG_ID,
    userId: OWNER.uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: NOW,
    updatedAt: NOW,
    unitId: null,
    permissions: defaultPermissionsForRole('owner'),
    commissionRate: null,
  } satisfies Membership)
  batch.set(db.collection('users').doc(OWNER.uid), {
    uid: OWNER.uid,
    email: OWNER.email,
    displayName: OWNER.displayName,
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: ORG_ID,
    whatsapp: OWNER.whatsapp,
    birthDate: '1988-05-20',
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: true,
    claimedAt: NOW,
    termsAcceptedAt: NOW,
    termsVersion: '1',
    privacyAcceptedAt: NOW,
    privacyVersion: '1',
    anonymizedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies User)

  for (const u of UNITS) {
    // Build the agenda union (PRD Identidade v2): appointment units carry the
    // agenda-only configs + force-published self-booking (so the seed page is
    // live); the always_open walk-in unit carries none.
    const agenda: UnitAgendaConfig = buildSeedAgenda(u.hoursMode)
    batch.set(ref(`units/${u.id}`), {
      id: u.id,
      orgId: ORG_ID,
      name: u.name,
      slug: u.slug,
      whatsapp: u.whatsapp,
      email: null,
      address: u.address,
      // Timezone is the establishment's (PRD Identidade v2 — moved Org→Unit).
      timezone: ORG_TZ,
      agenda,
      archivedAt: null,
      // Barbearia do Zé's units stay informal (no CNPJ) — the operational
      // baseline. Formalization is an opt-in upgrade (brief 0048).
      fiscal: { kind: 'informal' },
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Unit)
    // PII sibling doc the read path enriches from (#1036, ADR 0010). Mirrors
    // `writeUnitPii` — `orgs/{t}/units_pii/{id}` = { whatsapp, email }.
    batch.set(ref(`units_pii/${u.id}`), {
      whatsapp: u.whatsapp,
      email: null,
    } satisfies UnitPii)
  }

  batch.set(ref(`categories/${CATEGORY_ID}`), {
    id: CATEGORY_ID,
    orgId: ORG_ID,
    name: 'Cabelo',
    icon: null,
    color: null,
    active: true,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies Category)

  // public-visible so the public catalog has bookable services. Legacy
  // `services`/`products` collections stay seeded until the UI converges on the
  // unified catalog (#1005); consumers already read `catalog_items` (#1004).
  for (const svc of SERVICE_DOCS) {
    batch.set(ref(`services/${svc.id}`), svc)
  }

  // Unified catalog (brief 0023). Same ids as the legacy docs so historical
  // appointments/orders resolve, and the consumer surfaces read from here.
  for (const item of [...CATALOG_SERVICE_DOCS, ...CATALOG_PRODUCT_DOCS]) {
    batch.set(ref(`catalog_items/${item.id}`), item)
  }

  for (const p of PROFESSIONALS) {
    // A pro WITHOUT a whatsapp models a real pre-completion state: invited +
    // logged in via OAuth, but hasn't finished the profile form (which requires
    // whatsapp ∧ birthDate). Approval is derived (#1047): no whatsapp → not
    // approved. `buildUser` resolves the right union branch from `completed`.
    const completed = p.whatsapp.length > 0
    // Global User doc — identity source of truth (#1046, AC-04/AC-05). The read
    // path merges name/whatsapp/email LIVE from here.
    batch.set(
      db.collection('users').doc(p.userId),
      buildUser(p.userId, NOW, {
        email: p.email,
        displayName: p.name,
        emailVerified: true,
        currentOrgId: ORG_ID,
        whatsapp: completed ? p.whatsapp : null,
        birthDate: completed ? p.birthDate : null,
        completionCompleted: completed,
        claimedAt: NOW,
        termsAcceptedAt: NOW,
        termsVersion: '1',
        privacyAcceptedAt: NOW,
        privacyVersion: '1',
      }),
    )

    // Per-org PII sibling doc the read path enriches from (#1036, ADR
    // 0010). After #1046 it holds only `taxIdentity` — name/whatsapp/email
    // live on the global User (read live). The Professional projection itself
    // is NOT written here: it materializes from `professional.created` after
    // the batch commits (event-first, see `seedProfessional` below).
    batch.set(ref(`professionals_pii/${p.id}`), {
      taxIdentity: null,
    } satisfies ProfessionalPii)
  }

  // Receptionist (brief 0030, AC-05): global User + active Membership
  // (role=receptionist), NO Professional projection. A member who can be
  // attributed to retail items and earns commission without being a pro.
  batch.set(db.collection('users').doc(RECEPTIONIST.userId), {
    uid: RECEPTIONIST.userId,
    email: RECEPTIONIST.email,
    displayName: RECEPTIONIST.name,
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: ORG_ID,
    whatsapp: RECEPTIONIST.whatsapp,
    birthDate: RECEPTIONIST.birthDate,
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: true,
    claimedAt: NOW,
    termsAcceptedAt: NOW,
    termsVersion: '1',
    privacyAcceptedAt: NOW,
    privacyVersion: '1',
    anonymizedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies User)
  const recepMembershipId = membershipDocId(ORG_ID, RECEPTIONIST.userId)
  batch.set(db.collection('memberships').doc(recepMembershipId), {
    id: recepMembershipId,
    orgId: ORG_ID,
    userId: RECEPTIONIST.userId,
    role: 'receptionist',
    status: 'active',
    invitedBy: OWNER.uid,
    joinedAt: NOW,
    updatedAt: NOW,
    unitId: null,
    permissions: defaultPermissionsForRole('receptionist'),
    commissionRate: null,
  } satisfies Membership)

  // PII on the global User, operational shadow per-org.
  for (const c of CUSTOMERS) {
    batch.set(
      db.collection('users').doc(c.userId),
      buildUser(c.userId, NOW, {
        email: c.email,
        displayName: c.name,
        avatarUrl: c.avatarUrl,
        whatsapp: c.whatsapp,
        birthDate: c.birthDate,
      }),
    )

    batch.set(ref(`customers/${c.id}`), buildStoredCustomer(c.id, ORG_ID, c.userId, NOW))

    // Reverse-index backfill (brief 0032 / #1097, AC-10): the identity-layer
    // link `users/{uid}/org_links/{orgId}` that the customer-creation saga
    // writes in the live app — seeded here so existing customers are
    // discoverable in settings/privacy. References only, zero PII.
    batch.set(db.doc(orgLinkDocPath(c.userId, ORG_ID)), {
      orgId: ORG_ID,
      linkedAt: NOW,
    } satisfies OrgLink)
  }

  for (const pr of PRODUCTS) {
    batch.set(ref(`products/${pr.id}`), {
      id: pr.id,
      orgId: ORG_ID,
      name: pr.name,
      sku: null,
      priceCents: pr.priceCents,
      stock: pr.stock,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Product)
  }

  batch.set(ref(`subscription_plans/${PLAN_ID}`), {
    id: PLAN_ID,
    orgId: ORG_ID,
    name: 'Plano Mensal Corte',
    description: 'Cortes ilimitados todo mês.',
    priceCents: 9000,
    billingCycle: 'monthly',
    includedItemIds: ['seed-svc-corte'],
    includedCategoryIds: [CATEGORY_ID],
    usageLimit: { kind: 'unlimited' },
    active: true,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies SubscriptionPlan)

  const sub = CUSTOMERS[0]!
  const periodEnd = fromOrgTime(
    { date: shiftDateInOrgTz(today, 30, ORG_TZ), hour: 12, minute: 0 },
    ORG_TZ,
  )
  batch.set(ref(`subscriptions/seed-sub-1`), {
    id: 'seed-sub-1',
    orgId: ORG_ID,
    unitId: 'seed-unit-centro',
    customerId: sub.id,
    customerUserId: sub.userId,
    plan: {
      planId: PLAN_ID,
      name: 'Plano Mensal Corte',
      priceCents: 9000,
      billingCycle: 'monthly',
      includedItemIds: ['seed-svc-corte'],
      includedCategoryIds: [CATEGORY_ID],
      usageLimit: { kind: 'unlimited' },
    },
    status: 'active',
    currentPeriod: { startAt: NOW, endAt: periodEnd, consumed: 0 },
    cancelAtPeriodEnd: false,
    nextChargeDate: periodEnd,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies Subscription)

  // Spread across yesterday/today/tomorrow so the agenda + dashboard always
  // have live data. Snapshots derive from the service via resolveServiceForUnit,
  // mirroring the booking flow.
  const appts: Array<{
    id: string
    unitId: string
    professionalId: string
    customer: (typeof CUSTOMERS)[number]
    service: Service
    date: string
    hour: number
    status: AppointmentStatus
  }> = [
    {
      id: 'seed-appt-1',
      unitId: 'seed-unit-centro',
      professionalId: 'seed-prof-ze',
      customer: CUSTOMERS[0]!,
      service: SERVICE_DOCS[0]!,
      date: today,
      hour: 10,
      status: 'scheduled',
    },
    {
      id: 'seed-appt-2',
      unitId: 'seed-unit-centro',
      professionalId: 'seed-prof-maria',
      customer: CUSTOMERS[1]!,
      service: SERVICE_DOCS[2]!,
      date: today,
      hour: 11,
      status: 'scheduled',
    },
    {
      id: 'seed-appt-3',
      unitId: 'seed-unit-zona-sul',
      professionalId: 'seed-prof-joao',
      customer: CUSTOMERS[2]!,
      service: SERVICE_DOCS[1]!,
      date: today,
      hour: 14,
      status: 'scheduled',
    },
    {
      id: 'seed-appt-4',
      unitId: 'seed-unit-centro',
      professionalId: 'seed-prof-ze',
      customer: CUSTOMERS[3]!,
      service: SERVICE_DOCS[0]!,
      date: yesterday,
      hour: 15,
      status: 'completed',
    },
    {
      id: 'seed-appt-5',
      unitId: 'seed-unit-zona-sul',
      professionalId: 'seed-prof-maria',
      customer: CUSTOMERS[0]!,
      service: SERVICE_DOCS[3]!,
      date: tomorrow,
      hour: 9,
      status: 'scheduled',
    },
    ...buildDemoAppts(today, yesterday, tomorrow),
  ]
  for (const a of appts) {
    const resolved = resolveServiceForUnit(a.service, a.unitId)
    const startAt = fromOrgTime({ date: a.date, hour: a.hour, minute: 0 }, ORG_TZ)
    const endAt = new Date(
      new Date(startAt).getTime() + resolved.durationMinutes * 60_000,
    ).toISOString()
    batch.set(ref(`appointments/${a.id}`), {
      id: a.id,
      orgId: ORG_ID,
      unitId: a.unitId,
      professionalId: a.professionalId,
      customerId: a.customer.id,
      serviceId: a.service.id,
      startAt,
      endAt,
      status: a.status,
      servicePriceCentsSnapshot: resolved.priceCents,
      serviceDurationMinutesSnapshot: resolved.durationMinutes,
      commissionSnapshot: resolved.commission,
      // Snapshot da cancellation policy do org no commit (#1038). Espelha o
      // valor seedado em `cancellationPolicy` acima.
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
      customerUserId: a.customer.userId,
      professionalUserId: null,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Appointment)
  }

  await batch.commit()

  // Professionals are event-sourced (membership + professional aggregates), so
  // they materialize OUTSIDE the batch — after it commits — via the same
  // `emitEvent` path the app uses. Each pro replays the invite-accept saga
  // (#1045): `membership.created` (role=professional) → `professional.created`
  // (operational snapshot) → `professional.activated` (derived,
  // #1047). Sequenced (not parallel) so versions are deterministic.
  for (const p of PROFESSIONALS) {
    await seedProfessional(p)
  }

  // Closed sales so the `/reports` hub (brief 0031) has Vendas + Comissões data.
  await seedClosedSales(today)

  await seedExtraCategories()
  await seedExtraCatalogItems()
  await seedExtraPlans()
  await seedSubscriptionVariants(today)
  await seedPendingInvites(today)
  await seedOpenOrders()
  await seedAgendaBlocks(today)
  await seedExpenses()
  await seedFormalizationOrgs()
}

// Formalization manual-testing fixtures (brief 0048 / PRD Identidade v2). The
// fiscal identity lives on the UNIT, not the Org. Leaves a SECOND owner with two
// orgs ready to exercise the Formalizar flow:
//   (a) an org with an INFORMAL unit (no CNPJ) — see the "Formalizar unidade"
//       CTA + flow;
//   (b) an org with a COMPANY unit (already formalized) — see the read-only
//       fiscal section.
// Seeded directly (bypassing the UI). The owner alternates via the org switcher.
const FORMALIZE_OWNER = {
  uid: 'seed-formalize-owner',
  email: 'fiscal@cbrl.local',
  displayName: 'Ana Fiscal',
  whatsapp: '5511988880000',
}
const FORMALIZE_INFORMAL_ORG_ID = 'seed-org-informal'
const FORMALIZE_COMPANY_ORG_ID = 'seed-org-company'
// Canonical fixture CNPJ (brief 0048): CABRAL TECNOLOGIA LTDA, Simples, ATIVA.
const FIXTURE_CNPJ = '40148980000199'

async function ensureFormalizeOwnerAuth(): Promise<void> {
  try {
    await auth.getUser(FORMALIZE_OWNER.uid)
    return
  } catch (err: unknown) {
    if (!hasErrorCode(err, 'auth/user-not-found')) throw err
  }
  const result = await auth.importUsers([
    {
      uid: FORMALIZE_OWNER.uid,
      email: FORMALIZE_OWNER.email,
      emailVerified: true,
      displayName: FORMALIZE_OWNER.displayName,
      providerData: [
        {
          uid: FORMALIZE_OWNER.email,
          providerId: 'google.com',
          email: FORMALIZE_OWNER.email,
          displayName: FORMALIZE_OWNER.displayName,
        },
      ],
    },
  ])
  if (result.failureCount > 0) {
    throw new Error(`importUsers failed: ${result.errors.map((e) => e.error.message).join('; ')}`)
  }
}

async function seedFormalizationOrgs(): Promise<void> {
  await ensureFormalizeOwnerAuth()
  const batch = db.batch()
  const now = NOW

  const fixtureProfile: CompanyProfile = {
    taxId: FIXTURE_CNPJ,
    isMei: false,
    taxRegime: 'simples_nacional',
    primaryActivity: {
      code: '6201501',
      description: 'Desenvolvimento de programas de computador sob encomenda',
    },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    shareCapital: 1000,
    activityStartedAt: '2020-12-17',
  }

  // (a) Org with an informal unit — no CNPJ; the owner sees the Formalizar CTA.
  const informalRef = db.collection('orgs').doc(FORMALIZE_INFORMAL_ORG_ID)
  batch.set(informalRef, {
    id: FORMALIZE_INFORMAL_ORG_ID,
    name: 'Estúdio Informal',
    slug: 'estudio-informal',
    vertical: 'barbershop',
    ownerUserId: FORMALIZE_OWNER.uid,
    branding: { logoUrl: null, bannerUrl: null, description: 'Opera sem CNPJ (estágio informal).' },
    createdAt: now,
    updatedAt: now,
  } satisfies Org)
  seedFormalizeUnit(batch, FORMALIZE_INFORMAL_ORG_ID, 'Estúdio Informal — Centro', {
    kind: 'informal',
  })
  seedFormalizeMembership(batch, FORMALIZE_INFORMAL_ORG_ID)

  // (b) Org with a formalized unit — the owner sees the read-only fiscal
  // section. CompanyProfile in StoredUnit; razão social/fantasia in the per-unit
  // PII doc.
  const companyRef = db.collection('orgs').doc(FORMALIZE_COMPANY_ORG_ID)
  batch.set(companyRef, {
    id: FORMALIZE_COMPANY_ORG_ID,
    name: 'Cabral Tecnologia',
    slug: 'cabral-tecnologia',
    vertical: 'barbershop',
    ownerUserId: FORMALIZE_OWNER.uid,
    branding: { logoUrl: null, bannerUrl: null, description: 'Empresa formalizada (CNPJ ATIVA).' },
    createdAt: now,
    updatedAt: now,
  } satisfies Org)
  // The formalized unit carries the CNPJ-14 + CompanyProfile (non-PII) on its
  // `fiscal`; razão social + nome fantasia → deletable per-unit PII doc
  // (LGPD, ADR 0010). Ordem 0001 = matriz (derived from the CNPJ-14, not stored).
  seedFormalizeUnit(batch, FORMALIZE_COMPANY_ORG_ID, 'Cabral Tecnologia — Centro', {
    kind: 'company',
    taxId: FIXTURE_CNPJ,
    companyProfile: fixtureProfile,
    formalizedAt: now,
  })
  seedFormalizeMembership(batch, FORMALIZE_COMPANY_ORG_ID)

  // The second owner's user doc (currentOrgId = the informal one, so the
  // Formalizar flow is front-and-center on first login).
  batch.set(db.collection('users').doc(FORMALIZE_OWNER.uid), {
    uid: FORMALIZE_OWNER.uid,
    email: FORMALIZE_OWNER.email,
    displayName: FORMALIZE_OWNER.displayName,
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: FORMALIZE_INFORMAL_ORG_ID,
    whatsapp: FORMALIZE_OWNER.whatsapp,
    birthDate: '1990-03-10',
    taxIdentity: null,
    bio: null,
    specialties: null,
    completionCompleted: true,
    claimedAt: now,
    termsAcceptedAt: now,
    termsVersion: '1',
    privacyAcceptedAt: now,
    privacyVersion: '1',
    anonymizedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies User)

  await batch.commit()
}

function seedFormalizeUnit(
  batch: FirebaseFirestore.WriteBatch,
  orgId: string,
  name: string,
  fiscal: UnitFiscal,
): void {
  const unitRef = db.collection('orgs').doc(orgId).collection('units').doc(`${orgId}-centro`)
  const unit: Unit = {
    id: unitRef.id,
    orgId,
    name,
    slug: 'centro',
    whatsapp: FORMALIZE_OWNER.whatsapp,
    email: null,
    // Real address/hours: a Unidade is an operating establishment (PRD
    // Identidade v2 — address/timezone/agenda are required).
    address: {
      postalCode: '01310-100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
      number: '1000',
      complement: null,
    },
    timezone: ORG_TZ,
    // Appointment agenda (context 3): the agenda-only configs (slot/policy/
    // templates/self-booking publish) live ONLY in this variant.
    agenda: {
      mode: 'appointment',
      businessHours: BUSINESS_HOURS,
      slotMinutes: 30,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
      confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      selfBookingPublished: true,
      selfBookingPublishedAt: NOW,
    },
    archivedAt: null,
    // The fiscal identity lives on the unit (brief 0048): informal → no CNPJ;
    // company → CNPJ-14 + CompanyProfile (non-PII). Matriz/raiz derived on read.
    fiscal,
    createdAt: NOW,
    updatedAt: NOW,
  }
  batch.set(unitRef, unit)
  batch.set(db.collection('orgs').doc(orgId).collection('units_pii').doc(unitRef.id), {
    whatsapp: FORMALIZE_OWNER.whatsapp,
    email: null,
  } satisfies UnitPii)
  // A formalized unit's razão social + nome fantasia (PII) live in the deletable
  // per-unit doc (LGPD, ADR 0010); an informal unit has none.
  if (fiscal.kind === 'company') {
    batch.set(unitRef.collection('private').doc('taxIdentity'), {
      taxIdentity: {
        kind: 'company',
        taxId: fiscal.taxId,
        legalName: 'CABRAL TECNOLOGIA LTDA',
        tradeName: 'CABRAL TECH',
      },
    })
  }
}

function seedFormalizeMembership(batch: FirebaseFirestore.WriteBatch, orgId: string): void {
  const mId = membershipDocId(orgId, FORMALIZE_OWNER.uid)
  batch.set(db.collection('memberships').doc(mId), {
    id: mId,
    orgId,
    userId: FORMALIZE_OWNER.uid,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: NOW,
    updatedAt: NOW,
    unitId: null,
    permissions: defaultPermissionsForRole('owner'),
    commissionRate: null,
  } satisfies Membership)
}

// Agenda blocks (bloqueios): recurring weekly lunch breaks (whole unit) + a
// one-off block for a single professional, so the agenda renders both kinds.
async function seedAgendaBlocks(today: string): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  for (const weekday of ['monday', 'wednesday', 'friday'] as const) {
    const id = `seed-block-almoco-${weekday}`
    batch.set(docRef(`agenda_blocks/${id}`), {
      id,
      orgId: ORG_ID,
      unitId: 'seed-unit-centro',
      professionalId: null,
      reason: 'Almoço',
      kind: 'recurring',
      weekday,
      open: '12:00',
      close: '13:00',
      startAt: null,
      endAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies AgendaBlock)
  }

  const tomorrow = shiftDateInOrgTz(today, 1, ORG_TZ)
  batch.set(docRef(`agenda_blocks/seed-block-medico`), {
    id: 'seed-block-medico',
    orgId: ORG_ID,
    unitId: 'seed-unit-centro',
    professionalId: 'seed-prof-ze',
    reason: 'Consulta médica',
    kind: 'one_off',
    weekday: null,
    open: null,
    close: null,
    startAt: fromOrgTime({ date: tomorrow, hour: 14, minute: 0 }, ORG_TZ),
    endAt: fromOrgTime({ date: tomorrow, hour: 16, minute: 0 }, ORG_TZ),
    createdAt: NOW,
    updatedAt: NOW,
  } satisfies AgendaBlock)

  await batch.commit()
}

// Expense categories + cash movements beyond sales: a despesa (with category),
// a sangria (cash out) and a suprimento (cash in) — exercises the full caixa.
async function seedExpenses(): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  const EXPENSE_CATS = [
    { id: 'seed-exp-cat-aluguel', name: 'Aluguel' },
    { id: 'seed-exp-cat-insumos', name: 'Insumos' },
    { id: 'seed-exp-cat-marketing', name: 'Marketing' },
  ]
  for (const c of EXPENSE_CATS) {
    batch.set(docRef(`expense_categories/${c.id}`), {
      id: c.id,
      orgId: ORG_ID,
      name: c.name,
      archived: false,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies ExpenseCategory)
  }
  await batch.commit()

  const eventPath = (path: string) => `orgs/${ORG_ID}/${path}`
  const MOVES: Array<{
    id: string
    kind: 'despesa' | 'sangria' | 'suprimento'
    direction: 'in' | 'out'
    amountCents: number
    expenseCategoryId: string | null
    description: string
  }> = [
    {
      id: 'seed-mov-despesa-1',
      kind: 'despesa',
      direction: 'out',
      amountCents: 120000,
      expenseCategoryId: 'seed-exp-cat-aluguel',
      description: 'Aluguel do mês',
    },
    {
      id: 'seed-mov-despesa-2',
      kind: 'despesa',
      direction: 'out',
      amountCents: 35000,
      expenseCategoryId: 'seed-exp-cat-insumos',
      description: 'Compra de produtos',
    },
    {
      id: 'seed-mov-sangria-1',
      kind: 'sangria',
      direction: 'out',
      amountCents: 20000,
      expenseCategoryId: null,
      description: 'Sangria do caixa',
    },
    {
      id: 'seed-mov-suprimento-1',
      kind: 'suprimento',
      direction: 'in',
      amountCents: 10000,
      expenseCategoryId: null,
      description: 'Suprimento (troco)',
    },
  ]
  for (const m of MOVES) {
    const common = {
      id: m.id,
      orgId: ORG_ID,
      unitId: 'seed-unit-centro',
      amountCents: m.amountCents,
      description: m.description,
      recordedByUid: OWNER.uid,
      createdAt: NOW,
    }
    let movement: CashMovement
    switch (m.kind) {
      case 'despesa':
        movement = {
          ...common,
          kind: 'despesa',
          direction: 'out',
          orderId: null,
          paymentMethod: null,
          expenseCategoryId: m.expenseCategoryId,
        }
        break
      case 'sangria':
        movement = {
          ...common,
          kind: 'sangria',
          direction: 'out',
          orderId: null,
          paymentMethod: null,
          expenseCategoryId: null,
        }
        break
      case 'suprimento':
        movement = {
          ...common,
          kind: 'suprimento',
          direction: 'in',
          orderId: null,
          paymentMethod: null,
          expenseCategoryId: null,
        }
        break
    }
    const created = await emitEvent(CashMovementConfig, eventPath(`cash_movements/${m.id}`), {
      _tag: 'cash_movement.created',
      actorId: OWNER.uid,
      payload: { data: movement },
    })
    if (!created.ok) throw new Error(`cash_movement.created failed for ${m.id}: ${created.error}`)
  }
}

// Subscription plans covering every axis (cycle, item/category coverage, usage
// limit, unit allowlist, time scope, booking limits, archived). Source =
// `PLAN_VARIANTS`.
async function seedExtraPlans(): Promise<void> {
  const batch = db.batch()
  for (const plan of PLAN_VARIANTS) {
    batch.set(db.doc(`orgs/${ORG_ID}/subscription_plans/${plan.id}`), plan)
  }
  await batch.commit()
}

// One category is inactive, to exercise the catalog's "Inativo" branch.
async function seedExtraCategories(): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  const CATS = [
    { id: 'seed-cat-barba', name: 'Barba', active: true },
    { id: 'seed-cat-estetica', name: 'Estética', active: true },
    { id: 'seed-cat-produtos', name: 'Produtos', active: true },
    { id: 'seed-cat-promo', name: 'Promoções', active: false },
  ]
  for (const c of CATS) {
    batch.set(docRef(`categories/${c.id}`), {
      id: c.id,
      orgId: ORG_ID,
      name: c.name,
      icon: null,
      color: null,
      active: c.active,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Category)
  }

  await batch.commit()
}

// Catalog items spread across the categories, with varied active/public flags.
async function seedExtraCatalogItems(): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  type ServiceItemSpec = {
    id: string
    name: string
    categoryId: string
    priceCents: number
    durationMinutes: number
    active?: boolean
    publicVisible?: boolean
  }
  type ProductItemSpec = {
    id: string
    name: string
    categoryId: string
    priceCents: number
    stock: number
    active?: boolean
    publicVisible?: boolean
  }
  const svcItem = (s: ServiceItemSpec): CatalogServiceItem => ({
    id: s.id,
    orgId: ORG_ID,
    kind: 'service',
    name: s.name,
    categoryId: s.categoryId,
    priceCents: s.priceCents,
    commission: COMMISSION,
    unitIds: UNIT_IDS,
    unitOverrides: null,
    publicVisible: s.publicVisible ?? true,
    priceVisibility: 'visible',
    active: s.active ?? true,
    archivedAt: null,
    durationMinutes: s.durationMinutes,
    requiredResources: [],
    createdAt: NOW,
    updatedAt: NOW,
  })
  const prodItem = (p: ProductItemSpec): CatalogProductItem => ({
    id: p.id,
    orgId: ORG_ID,
    kind: 'product',
    name: p.name,
    categoryId: p.categoryId,
    priceCents: p.priceCents,
    commission: RETAIL_COMMISSION,
    unitIds: UNIT_IDS,
    unitOverrides: null,
    publicVisible: p.publicVisible ?? true,
    priceVisibility: 'visible',
    active: p.active ?? true,
    archivedAt: null,
    sku: null,
    stock: p.stock,
    createdAt: NOW,
    updatedAt: NOW,
  })
  const EXTRA_ITEMS: Array<CatalogServiceItem | CatalogProductItem> = [
    svcItem({
      id: 'seed-svc-pezinho',
      name: 'Pezinho',
      categoryId: 'seed-cat-cabelo',
      priceCents: 1500,
      durationMinutes: 15,
    }),
    svcItem({
      id: 'seed-svc-degrade',
      name: 'Degradê',
      categoryId: 'seed-cat-cabelo',
      priceCents: 5000,
      durationMinutes: 45,
    }),
    svcItem({
      id: 'seed-svc-barboterapia',
      name: 'Barboterapia',
      categoryId: 'seed-cat-barba',
      priceCents: 5500,
      durationMinutes: 45,
    }),
    svcItem({
      id: 'seed-svc-hidratacao',
      name: 'Hidratação',
      categoryId: 'seed-cat-estetica',
      priceCents: 4000,
      durationMinutes: 30,
      publicVisible: false,
    }),
    svcItem({
      id: 'seed-svc-limpeza',
      name: 'Limpeza de pele',
      categoryId: 'seed-cat-estetica',
      priceCents: 6000,
      durationMinutes: 50,
      active: false,
    }),
    prodItem({
      id: 'seed-prod-cera',
      name: 'Cera Modeladora',
      categoryId: 'seed-cat-produtos',
      priceCents: 4200,
      stock: 18,
    }),
    prodItem({
      id: 'seed-prod-oleo',
      name: 'Óleo para Barba',
      categoryId: 'seed-cat-produtos',
      priceCents: 3900,
      stock: 12,
    }),
    prodItem({
      id: 'seed-prod-kit',
      name: 'Kit Promo',
      categoryId: 'seed-cat-promo',
      priceCents: 9900,
      stock: 5,
      active: false,
    }),
  ]
  for (const item of EXTRA_ITEMS) {
    batch.set(docRef(`catalog_items/${item.id}`), item)
  }

  await batch.commit()
}

// Subscriptions covering every status (past_due, suspended, cancelled,
// active-but-cancel-at-period-end), each snapshotting a different plan variant
// (cycle / usage limit / scope) with varied `consumed`.
async function seedSubscriptionVariants(today: string): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  const periodEnd = fromOrgTime(
    { date: shiftDateInOrgTz(today, 30, ORG_TZ), hour: 12, minute: 0 },
    ORG_TZ,
  )
  const [trimestral, anual, semestral] = PLAN_VARIANTS
  const SUBS: Array<{
    id: string
    customer: (typeof CUSTOMERS)[number]
    plan: SubscriptionPlan
    status: 'active' | 'past_due' | 'suspended' | 'cancelled'
    cancelAtPeriodEnd: boolean
    pastDueCycles: number
    consumed: number
    cancelledAt: string | null
    cancellationReason: string | null
  }> = [
    {
      id: 'seed-sub-pastdue',
      customer: CUSTOMERS[1]!,
      plan: trimestral!,
      status: 'past_due',
      cancelAtPeriodEnd: false,
      pastDueCycles: 1,
      consumed: 3,
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      id: 'seed-sub-suspended',
      customer: CUSTOMERS[2]!,
      plan: semestral!,
      status: 'suspended',
      cancelAtPeriodEnd: false,
      pastDueCycles: 2,
      consumed: 11,
      cancelledAt: null,
      cancellationReason: null,
    },
    {
      id: 'seed-sub-cancelled',
      customer: CUSTOMERS[3]!,
      plan: anual!,
      status: 'cancelled',
      cancelAtPeriodEnd: false,
      pastDueCycles: 0,
      consumed: 0,
      cancelledAt: NOW,
      cancellationReason: 'Cliente pediu cancelamento',
    },
    {
      id: 'seed-sub-cancelatend',
      customer: CUSTOMERS[4]!,
      plan: trimestral!,
      status: 'active',
      cancelAtPeriodEnd: true,
      pastDueCycles: 0,
      consumed: 7,
      cancelledAt: null,
      cancellationReason: null,
    },
  ]
  for (const s of SUBS) {
    batch.set(docRef(`subscriptions/${s.id}`), {
      id: s.id,
      orgId: ORG_ID,
      unitId: 'seed-unit-centro',
      customerId: s.customer.id,
      customerUserId: s.customer.userId,
      plan: planToSnapshot(s.plan),
      status: s.status,
      currentPeriod: { startAt: NOW, endAt: periodEnd, consumed: s.consumed },
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      nextChargeDate: s.status === 'cancelled' ? null : periodEnd,
      pastDueCycles: s.pastDueCycles,
      pastDueThreshold: 2,
      cancellationReason: s.cancellationReason,
      cancelledAt: s.cancelledAt,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies Subscription)
  }

  await batch.commit()
}

// Pending invites for the "Convites pendentes" tab — each is a StoredInvite doc
// plus its deletable PII sidecar (`invites_pii`).
async function seedPendingInvites(today: string): Promise<void> {
  const batch = db.batch()
  const docRef = (path: string) => db.doc(`orgs/${ORG_ID}/${path}`)

  const invitesExpireAt = fromOrgTime(
    { date: shiftDateInOrgTz(today, 7, ORG_TZ), hour: 12, minute: 0 },
    ORG_TZ,
  )
  const INVITES: Array<{
    id: string
    email: string
    role: 'professional' | 'receptionist' | 'manager'
  }> = [
    { id: 'seed-invite-1', email: 'novo.barbeiro@example.com', role: 'professional' },
    { id: 'seed-invite-2', email: 'recepcao.nova@example.com', role: 'receptionist' },
    { id: 'seed-invite-3', email: 'gerente@example.com', role: 'manager' },
  ]
  for (const inv of INVITES) {
    batch.set(docRef(`invites/${inv.id}`), {
      id: inv.id,
      orgId: ORG_ID,
      role: inv.role,
      tokenHash: `seed-hash-${inv.id}`,
      expiresAt: invitesExpireAt,
      status: 'pending',
      invitedBy: OWNER.uid,
      acceptedByUid: null,
      acceptedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies StoredInvite)
    batch.set(docRef(`invites_pii/${inv.id}`), { email: inv.email } satisfies InvitePii)
  }

  await batch.commit()
}

// "Comandas abertas" — created through the event-first path, never closed (so
// they show as open in Vendas and feed the dashboard pendências).
async function seedOpenOrders(): Promise<void> {
  const eventPath = (path: string) => `orgs/${ORG_ID}/${path}`
  const OPEN_ORDERS: Array<{
    id: string
    unitId: string
    customer: (typeof CUSTOMERS)[number]
    line: {
      refId: string
      name: string
      unitPriceCents: number
      attributedUserId: string
      coverage?: 'sale' | 'subscription'
      subscriptionId?: string | null
    }
  }> = [
    {
      id: 'seed-open-1',
      unitId: 'seed-unit-centro',
      customer: CUSTOMERS[0]!,
      line: { refId: 'seed-svc-corte', name: 'Corte', unitPriceCents: 4500, attributedUserId: ZE },
    },
    {
      // Open comanda with a subscription-covered service (seed-cust-1 / seed-sub-1).
      id: 'seed-open-4',
      unitId: 'seed-unit-centro',
      customer: CUSTOMERS[0]!,
      line: {
        refId: 'seed-svc-corte',
        name: 'Corte',
        unitPriceCents: 4500,
        attributedUserId: ZE,
        coverage: 'subscription',
        subscriptionId: 'seed-sub-1',
      },
    },
    {
      id: 'seed-open-2',
      unitId: 'seed-unit-centro',
      customer: CUSTOMERS[5]!,
      line: {
        refId: 'seed-svc-combo',
        name: 'Corte + Barba',
        unitPriceCents: 7000,
        attributedUserId: MARIA,
      },
    },
    {
      id: 'seed-open-3',
      unitId: 'seed-unit-zona-sul',
      customer: CUSTOMERS[6]!,
      line: {
        refId: 'seed-svc-barba',
        name: 'Barba',
        unitPriceCents: 3000,
        attributedUserId: JOAO,
      },
    },
  ]
  for (const o of OPEN_ORDERS) {
    const covered = o.line.coverage === 'subscription'
    const items: OrderItem[] = [
      {
        id: `${o.id}-item-0`,
        kind: 'service',
        refId: o.line.refId,
        name: o.line.name,
        quantity: 1,
        unitPriceCents: o.line.unitPriceCents,
        commission: covered ? null : COMMISSION,
        attributedUserId: o.line.attributedUserId,
        coverage: o.line.coverage ?? 'sale',
        subscriptionId: o.line.subscriptionId ?? null,
      },
    ]
    const totals = computeOrderTotals(items, 0)
    const openOrder: Order = {
      id: o.id,
      orgId: ORG_ID,
      unitId: o.unitId,
      customerId: o.customer.id,
      appointmentId: null,
      status: 'open',
      items,
      discountCents: 0,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      createdAt: NOW,
      updatedAt: NOW,
    }
    const created = await emitEvent(OrderConfig, eventPath(`orders/${o.id}`), {
      _tag: 'order.created',
      actorId: OWNER.uid,
      payload: { data: openOrder },
    })
    if (!created.ok) throw new Error(`open order.created failed for ${o.id}: ${created.error}`)
  }
}

// Retail product commission rule (brief 0030): the catalog product carries no
// commission, but a sold retail item can be commissioned at the seller's rate —
// the rule is snapshotted on the order item at add-time. 20% here so the
// receptionist's by-member commission (AC-05/AC-07) is non-trivial.
const RETAIL_COMMISSION: CommissionRule = { kind: 'percentage', value: 20 }

// One closed sale to materialize. `daysAgo` backdates createdAt/closedAt within
// the period; `lines` are the order items (service or retail product) attributed
// per member; `paymentMethod` mirrors what the close dialog records.
type SaleSpec = {
  id: string
  unitId: string
  daysAgo: number
  hour: number
  customerId: string | null
  appointmentId: string | null
  paymentMethod: PaymentMethod
  lines: Array<{
    kind: 'service' | 'product'
    refId: string
    name: string
    unitPriceCents: number
    quantity: number
    commission: CommissionRule | null
    attributedUserId: string
    // When set, the item is covered by the subscription (no charge, no
    // commission) — exercises subscription consumption inside a sale.
    coverage?: 'sale' | 'subscription'
    subscriptionId?: string | null
  }>
}

// Deterministic plan: closed sales across BOTH units over the last ~10 days, so
// the period picker is exercisable and switching the active unit visibly changes
// the reports (brief 0044 — each surface reads only the active unit). Centro
// carries more/larger sales than Zona Sul. Mix of appointment-born service sales
// (attributed to the appointment's professional) and standalone retail product
// sales (attributed to the member who sold — including the receptionist).
const CENTRO = 'seed-unit-centro'
const ZONA_SUL = 'seed-unit-zona-sul'
const ZE = 'seed-user-prof-ze'
const MARIA = 'seed-user-prof-maria'
const JOAO = 'seed-user-prof-joao'
const RECEP = 'seed-user-recep'

// Identity-snapshot backfill (brief 0041 AC-11): maps attributed member userId →
// display name, mirroring what `listOrgMembers` resolves live at close time.
// Empty string for an unknown member (never throws) — same fallback as the app.
const SEED_MEMBER_NAME_BY_USER_ID: Record<string, string> = {
  ...Object.fromEntries(PROFESSIONALS.map((p) => [p.userId, p.name])),
  [RECEPTIONIST.userId]: RECEPTIONIST.name,
  [OWNER.uid]: OWNER.displayName,
}
const resolveSeedMemberName = (userId: string): string => SEED_MEMBER_NAME_BY_USER_ID[userId] ?? ''

// Volume + variety of closed sales: both units, last ~18 days, all 4 payment
// methods, and rotating baskets (single service, combo, service+retail, retail
// only, multi-service) attributed across professionals + the receptionist. Big
// enough to test the Vendas list scroll/pagination and the reports period/unit.
function buildDemoSales(): SaleSpec[] {
  const pros = [ZE, MARIA, JOAO]
  const units = [CENTRO, ZONA_SUL]
  const methods: PaymentMethod[] = ['pix', 'credit_card', 'debit_card', 'cash']
  const svc = (refId: string, name: string, unitPriceCents: number, attributedUserId: string) => ({
    kind: 'service' as const,
    refId,
    name,
    unitPriceCents,
    quantity: 1,
    commission: COMMISSION,
    attributedUserId,
  })
  const prod = (refId: string, name: string, unitPriceCents: number, quantity: number) => ({
    kind: 'product' as const,
    refId,
    name,
    unitPriceCents,
    quantity,
    commission: RETAIL_COMMISSION,
    attributedUserId: RECEP,
  })
  // Rotated baskets: single service, combo, service+retail, retail-only, multi.
  const basket = (i: number, pro: string): SaleSpec['lines'] => {
    switch (i % 5) {
      case 0:
        return [svc('seed-svc-corte', 'Corte', 4500, pro)]
      case 1:
        return [svc('seed-svc-combo', 'Corte + Barba', 7000, pro)]
      case 2:
        return [
          svc('seed-svc-barba', 'Barba', 3000, pro),
          prod('seed-prod-pomada', 'Pomada Modeladora', 3500, 1),
        ]
      case 3:
        return [prod('seed-prod-pomada', 'Pomada Modeladora', 3500, 2)]
      default:
        return [
          svc('seed-svc-corte', 'Corte', 4500, pro),
          svc('seed-svc-sobrancelha', 'Sobrancelha', 2000, pro),
        ]
    }
  }
  return Array.from({ length: 42 }, (_, i) => {
    const pro = pros[i % pros.length] ?? ZE
    return {
      id: `seed-sale-g${i + 1}`,
      unitId: units[i % units.length] ?? CENTRO,
      daysAgo: i % 18,
      hour: 9 + (i % 9),
      customerId: (CUSTOMERS[i % CUSTOMERS.length] ?? CUSTOMERS[0]!).id,
      appointmentId: null,
      paymentMethod: methods[i % methods.length] ?? 'pix',
      lines: basket(i, pro),
    }
  })
}
const DEMO_SALES = buildDemoSales()

// Volume + every status across the agenda: past days carry completed/cancelled/
// no_show, today is mostly scheduled (one completed), future is scheduled. Spread
// over both units + all professionals so the agenda and /me lists are full.
function buildDemoAppts(
  today: string,
  _yesterday: string,
  _tomorrow: string,
): Array<{
  id: string
  unitId: string
  professionalId: string
  customer: (typeof CUSTOMERS)[number]
  service: Service
  date: string
  hour: number
  status: AppointmentStatus
}> {
  const proIds = ['seed-prof-ze', 'seed-prof-maria', 'seed-prof-joao']
  const units = ['seed-unit-centro', 'seed-unit-zona-sul']
  const pastStatuses: AppointmentStatus[] = ['completed', 'cancelled', 'no_show']
  // Past days rotate completed/cancelled/no_show; today is mostly scheduled (one
  // completed); future is scheduled.
  const statusFor = (offset: number, idx: number): AppointmentStatus => {
    if (offset < 0) return pastStatuses[idx % pastStatuses.length] ?? 'completed'
    if (offset === 0 && idx % 5 === 0) return 'completed'
    return 'scheduled'
  }
  return Array.from({ length: 30 }, (_, i) => {
    // Spread from 3 days ago to 3 days ahead.
    const dayOffset = (i % 7) - 3
    const status = statusFor(dayOffset, i)
    return {
      id: `seed-appt-g${i + 1}`,
      unitId: units[i % units.length] ?? 'seed-unit-centro',
      professionalId: proIds[i % proIds.length] ?? 'seed-prof-ze',
      customer: CUSTOMERS[i % CUSTOMERS.length] ?? CUSTOMERS[0]!,
      service: SERVICE_DOCS[i % SERVICE_DOCS.length] ?? SERVICE_DOCS[0]!,
      date: shiftDateInOrgTz(today, dayOffset, ORG_TZ),
      hour: 9 + (i % 9),
      status,
    }
  })
}

const SALES: SaleSpec[] = [
  // — Centro: service sales attributed to the executing professional —
  {
    id: 'seed-sale-1',
    unitId: CENTRO,
    daysAgo: 9,
    hour: 10,
    customerId: 'seed-cust-1',
    appointmentId: null,
    paymentMethod: 'pix',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-corte',
        name: 'Corte',
        unitPriceCents: 4500,
        quantity: 1,
        commission: COMMISSION,
        attributedUserId: ZE,
      },
    ],
  },
  {
    id: 'seed-sale-2',
    unitId: CENTRO,
    daysAgo: 7,
    hour: 11,
    customerId: 'seed-cust-2',
    appointmentId: null,
    paymentMethod: 'credit_card',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-combo',
        name: 'Corte + Barba',
        unitPriceCents: 7000,
        quantity: 1,
        commission: COMMISSION,
        attributedUserId: MARIA,
      },
    ],
  },
  // — Centro: standalone retail sold by the RECEPTIONIST (non-professional
  //   seller, AC-05) — anonymous (no customer). Commissioned at retail rate. —
  {
    id: 'seed-sale-3',
    unitId: CENTRO,
    daysAgo: 5,
    hour: 16,
    customerId: null,
    appointmentId: null,
    paymentMethod: 'cash',
    lines: [
      {
        kind: 'product',
        refId: 'seed-prod-pomada',
        name: 'Pomada Modeladora',
        unitPriceCents: 3500,
        quantity: 2,
        commission: RETAIL_COMMISSION,
        attributedUserId: RECEP,
      },
    ],
  },
  // — Centro: mixed sale (service + retail) attributed to different members —
  {
    id: 'seed-sale-4',
    unitId: CENTRO,
    daysAgo: 2,
    hour: 14,
    customerId: 'seed-cust-4',
    appointmentId: null,
    paymentMethod: 'pix',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-corte',
        name: 'Corte',
        unitPriceCents: 4500,
        quantity: 1,
        commission: COMMISSION,
        attributedUserId: ZE,
      },
      {
        kind: 'product',
        refId: 'seed-prod-shampoo',
        name: 'Shampoo Anticaspa',
        unitPriceCents: 2800,
        quantity: 1,
        commission: RETAIL_COMMISSION,
        attributedUserId: RECEP,
      },
    ],
  },
  // — Zona Sul: smaller volume so the cross-unit aggregate differs visibly —
  {
    id: 'seed-sale-5',
    unitId: ZONA_SUL,
    daysAgo: 8,
    hour: 15,
    customerId: 'seed-cust-3',
    appointmentId: null,
    paymentMethod: 'debit_card',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-barba',
        name: 'Barba',
        unitPriceCents: 3000,
        quantity: 1,
        commission: COMMISSION,
        attributedUserId: JOAO,
      },
    ],
  },
  {
    id: 'seed-sale-6',
    unitId: ZONA_SUL,
    daysAgo: 1,
    hour: 12,
    customerId: null,
    appointmentId: null,
    paymentMethod: 'pix',
    lines: [
      {
        kind: 'product',
        refId: 'seed-prod-pomada',
        name: 'Pomada Modeladora',
        unitPriceCents: 3500,
        quantity: 1,
        commission: RETAIL_COMMISSION,
        attributedUserId: JOAO,
      },
    ],
  },
  ...DEMO_SALES,
  // Subscription-covered closed sales (seed-cust-1 owns seed-sub-1, which covers
  // Corte). One fully covered (total 0, no charge); one mixing a covered service
  // with a paid retail product.
  {
    id: 'seed-sale-cov-1',
    unitId: CENTRO,
    daysAgo: 2,
    hour: 10,
    customerId: 'seed-cust-1',
    appointmentId: null,
    paymentMethod: 'pix',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-corte',
        name: 'Corte',
        unitPriceCents: 4500,
        quantity: 1,
        commission: null,
        attributedUserId: ZE,
        coverage: 'subscription',
        subscriptionId: 'seed-sub-1',
      },
    ],
  },
  {
    id: 'seed-sale-cov-2',
    unitId: CENTRO,
    daysAgo: 5,
    hour: 16,
    customerId: 'seed-cust-1',
    appointmentId: null,
    paymentMethod: 'cash',
    lines: [
      {
        kind: 'service',
        refId: 'seed-svc-corte',
        name: 'Corte',
        unitPriceCents: 4500,
        quantity: 1,
        commission: null,
        attributedUserId: MARIA,
        coverage: 'subscription',
        subscriptionId: 'seed-sub-1',
      },
      {
        kind: 'product',
        refId: 'seed-prod-pomada',
        name: 'Pomada Modeladora',
        unitPriceCents: 3500,
        quantity: 1,
        commission: RETAIL_COMMISSION,
        attributedUserId: RECEP,
      },
    ],
  },
]

// Settled (paid) commissions so the Comissões section shows pendente + pago.
// Keyed by the order id whose commissions to mark — every 4th generated sale is
// paid alongside the two curated ones.
const PAID_SALE_IDS = new Set([
  'seed-sale-1',
  'seed-sale-3',
  ...DEMO_SALES.filter((_, i) => i % 4 === 0).map((s) => s.id),
])

// Sales whose close is undone (sale_reversal appended in the period). Append-only
// — the original `sale` movement is never deleted; the Vendas section reads both.
const REVERSED_SALE_IDS = new Set([
  'seed-sale-5',
  ...DEMO_SALES.filter((_, i) => i % 11 === 7).map((s) => s.id),
])

// Materializes every closed sale via the SAME event-first path the app uses
// (`order.created` → `commission.created` → `cash_movement.created` (sale) →
// `order.closed`), so the seeded read model is identical to what `closeOrder`
// produces — no ad-hoc dual-write. Commissions are keyed by `attributedUserId`
// and their source closed order lives in the same unit + window (the Comissões
// loader maps commission→unit via the closing order's `unitId`). One sale gets
// a `sale_reversal` movement appended so the reversal surfaces in Vendas.
// commission.created per commissionable item (same accrual the close flow runs).
// Born `pendente` (or `pago` for the paid seed set), identity name snapshotted.
async function seedSaleCommissions(
  saleId: string,
  items: OrderItem[],
  at: string,
  paid: boolean,
): Promise<void> {
  const ref = (path: string) => `orgs/${ORG_ID}/${path}`
  for (const item of items) {
    const accrual = accrueCommissionForItem(item, resolveSeedMemberName)
    if (!accrual) continue
    const commissionId = `${saleId}-comm-${accrual.orderItemId}`
    const commission: Commission = {
      id: commissionId,
      orgId: ORG_ID,
      orderId: saleId,
      orderItemId: accrual.orderItemId,
      attributedUserId: accrual.attributedUserId,
      attributedMemberName: accrual.attributedMemberName,
      itemKind: accrual.itemKind,
      itemName: accrual.itemName,
      itemTotalCents: accrual.itemTotalCents,
      commissionKind: accrual.commissionKind,
      commissionValue: accrual.commissionValue,
      amountCents: accrual.amountCents,
      liquidationStatus: (paid ? 'pago' : 'pendente') satisfies LiquidationStatus,
      paidAt: paid ? at : null,
      paymentProof: null,
      createdAt: at,
    }
    const commCreated = await emitEvent(CommissionConfig, ref(`commissions/${commissionId}`), {
      _tag: 'commission.created',
      actorId: OWNER.uid,
      payload: { data: commission },
    })
    if (!commCreated.ok) {
      throw new Error(`commission.created failed for ${commissionId}: ${commCreated.error}`)
    }
  }
}

// The saga tail of a seeded sale: cash `sale` movement → order.closed anchor →
// optional `sale_reversal` (append-only) for the one reversed seed sale.
async function seedSaleClosure(
  sale: (typeof SALES)[number],
  totals: ReturnType<typeof computeOrderTotals>,
  at: string,
): Promise<void> {
  const ref = (path: string) => `orgs/${ORG_ID}/${path}`

  if (totals.totalCents > 0) {
    const movementId = `${sale.id}-sale`
    const movement: CashMovement = {
      id: movementId,
      orgId: ORG_ID,
      unitId: sale.unitId,
      kind: 'sale',
      direction: 'in',
      amountCents: totals.totalCents,
      paymentMethod: sale.paymentMethod,
      description: null,
      orderId: sale.id,
      expenseCategoryId: null,
      recordedByUid: OWNER.uid,
      createdAt: at,
    }
    const saleMov = await emitEvent(CashMovementConfig, ref(`cash_movements/${movementId}`), {
      _tag: 'cash_movement.created',
      actorId: OWNER.uid,
      payload: { data: movement },
    })
    if (!saleMov.ok) throw new Error(`sale movement failed for ${sale.id}: ${saleMov.error}`)
  }

  const closed = await emitEvent(OrderConfig, ref(`orders/${sale.id}`), {
    _tag: 'order.closed',
    actorId: OWNER.uid,
    payload: {
      closedAt: at,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      paymentMethod: sale.paymentMethod,
    },
  })
  if (!closed.ok) throw new Error(`order.closed failed for ${sale.id}: ${closed.error}`)

  if (REVERSED_SALE_IDS.has(sale.id) && totals.totalCents > 0) {
    const reversalId = `${sale.id}-reversal`
    const reversal: CashMovement = {
      id: reversalId,
      orgId: ORG_ID,
      unitId: sale.unitId,
      kind: 'sale_reversal',
      direction: 'out',
      amountCents: totals.totalCents,
      paymentMethod: sale.paymentMethod,
      description: 'Estorno — fechamento desfeito',
      orderId: sale.id,
      expenseCategoryId: null,
      recordedByUid: OWNER.uid,
      createdAt: at,
    }
    const rev = await emitEvent(CashMovementConfig, ref(`cash_movements/${reversalId}`), {
      _tag: 'cash_movement.created',
      actorId: OWNER.uid,
      payload: { data: reversal },
    })
    if (!rev.ok) throw new Error(`sale_reversal failed for ${sale.id}: ${rev.error}`)
  }
}

async function seedClosedSales(today: string): Promise<void> {
  const ref = (path: string) => `orgs/${ORG_ID}/${path}`

  for (const sale of SALES) {
    const date = shiftDateInOrgTz(today, -sale.daysAgo, ORG_TZ)
    const at = fromOrgTime({ date, hour: sale.hour, minute: 0 }, ORG_TZ)

    const items: OrderItem[] = sale.lines.map((l, i) => ({
      id: `${sale.id}-item-${i}`,
      kind: l.kind,
      refId: l.refId,
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      commission: l.commission,
      attributedUserId: l.attributedUserId,
      coverage: l.coverage ?? 'sale',
      subscriptionId: l.subscriptionId ?? null,
    }))
    const totals = computeOrderTotals(items, 0)

    // 1) order.created — full open snapshot (the projection writes the doc).
    const openOrder: Order = {
      id: sale.id,
      orgId: ORG_ID,
      unitId: sale.unitId,
      customerId: sale.customerId,
      appointmentId: sale.appointmentId,
      status: 'open',
      items,
      discountCents: 0,
      closedAt: null,
      paymentMethod: null,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      createdAt: at,
      updatedAt: at,
    }
    const created = await emitEvent(OrderConfig, ref(`orders/${sale.id}`), {
      _tag: 'order.created',
      actorId: OWNER.uid,
      payload: { data: openOrder },
    })
    if (!created.ok) throw new Error(`order.created failed for ${sale.id}: ${created.error}`)

    // 2) commission.created per commissionable item (born pendente/pago).
    await seedSaleCommissions(sale.id, items, at, PAID_SALE_IDS.has(sale.id))

    // 3-5) cash sale movement → order.closed → optional reversal.
    await seedSaleClosure(sale, totals, at)
  }
}

// Materialize one professional in the new model. Mirrors the accept saga +
// `reconcileOperational`: emit the membership, the professional `created` event
// (NO denormalized identity — read live from `users/{userId}`), then derive the
// operational status and emit `professional.activated` only if the rule is met
// (the seeded User has whatsapp ∧ the pro gets ≥1 unit ∧ ≥1 service). The
// created snapshot carries the derived status, so a pro who accepted but is
// still missing whatsapp lands on `incomplete` instead of `operational`.
async function seedProfessional(p: (typeof PROFESSIONALS)[number]): Promise<void> {
  const membershipId = membershipDocId(ORG_ID, p.userId)
  const membershipData: Membership = {
    id: membershipId,
    orgId: ORG_ID,
    userId: p.userId,
    role: 'professional',
    status: 'active',
    invitedBy: OWNER.uid,
    joinedAt: NOW,
    updatedAt: NOW,
    unitId: null,
    permissions: defaultPermissionsForRole('professional'),
    commissionRate: null,
  }
  const membershipCreated = await emitEvent(MembershipConfig, `memberships/${membershipId}`, {
    _tag: 'membership.created',
    actorId: OWNER.uid,
    payload: { data: membershipData },
  })
  if (!membershipCreated.ok) {
    throw new Error(`membership.created failed for ${p.id}: ${membershipCreated.error}`)
  }

  // Derive the operational status from real facts (same rule as
  // `reconcileOperational`). The seed knows the User's whatsapp statically; the
  // projection gets its units/services here. A pro who accepted but is still
  // incomplete (no whatsapp) derives to `incomplete`.
  const derived = deriveOperationalStatus({
    inviteAccepted: true,
    whatsapp: p.whatsapp,
    unitIds: UNIT_IDS,
    serviceIds: SERVICE_IDS,
  })

  // Operational snapshot only — name/whatsapp/email live on the User (read
  // live), `taxIdentity` on the deletable PII doc.
  const stored: StoredProfessional = {
    id: p.id,
    orgId: ORG_ID,
    userId: p.userId,
    operationalStatus: derived,
    defaultCommission: null,
    unitIds: UNIT_IDS,
    serviceIds: SERVICE_IDS,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const proCreated = await emitEvent(ProfessionalConfig, `orgs/${ORG_ID}/professionals/${p.id}`, {
    _tag: 'professional.created',
    actorId: OWNER.uid,
    payload: { data: stored },
  })
  if (!proCreated.ok) {
    throw new Error(`professional.created failed for ${p.id}: ${proCreated.error}`)
  }

  // Emit the activation transition only when the derived status is operational.
  if (derived === 'operational') {
    const activated = await emitEvent(ProfessionalConfig, `orgs/${ORG_ID}/professionals/${p.id}`, {
      _tag: 'professional.activated',
      actorId: OWNER.uid,
      payload: {},
    })
    if (!activated.ok) {
      throw new Error(`professional.activated failed for ${p.id}: ${activated.error}`)
    }
  }
}

seed()
  .then(() => {
    const line = '─'.repeat(60)
    console.log(`\n${line}`)
    console.log('✅ Seed concluído — Barbearia do Zé')
    console.log(line)
    console.log(`  Entrar:       http://127.0.0.1:3005/login`)
    console.log(`                → "Continuar com Google" → escolha "${OWNER.displayName}"`)
    console.log(`                  (${OWNER.email})`)
    console.log(`  Landing:      http://127.0.0.1:3005/${ORG_SLUG}`)
    console.log(line)
    console.log(
      `  3 unidades (2 agendáveis + 1 walk-in always_open) · 4 profissionais (aprovado/pendente) · 1 recepcionista · 3 convites pendentes · ${CUSTOMERS.length} clientes (aniversariantes variados)`,
    )
    console.log(
      '  5 categorias (1 inativa) · 14 itens de catálogo (ativos/inativos, públicos/internos)',
    )
    console.log(`  ${5 + 30} agendamentos (todos os status, ±3 dias)`)
    console.log(
      `  ${SALES.length} vendas fechadas + 4 comandas abertas (ambas unidades, ~18 dias, 4 formas de pagamento, cestas variadas, ` +
        'itens cobertos por assinatura) · comissões por membro (pendentes + pagas) · estornos',
    )
    console.log(
      '  5 planos (mensal/trimestral/semestral/anual · limite contável/ilimitado · escopo de unidade/horário/limites · 1 arquivado)',
    )
    console.log(
      '  5 assinaturas (active · past_due · suspended · cancelled · cancela no fim do ciclo) com consumo variado',
    )
    console.log('  4 bloqueios de agenda (3 almoços recorrentes + 1 pontual por profissional)')
    console.log(
      '  3 categorias de despesa · 4 movimentos de caixa fora de venda (2 despesas · 1 sangria · 1 suprimento)',
    )
    console.log(
      `  Relatórios:   http://127.0.0.1:3005/reports  (Vendas + Comissões — unidade ativa)`,
    )
    console.log(line)
    console.log('  Formalização fiscal (brief 0048) — 2º dono "Ana Fiscal" (fiscal@cbrl.local):')
    console.log('    · Org informal "Estúdio Informal" → CTA Formalizar em /company')
    console.log('    · Unidade de "Cabral Tecnologia" já formalizada → seção fiscal read-only')
    console.log('    (alterne entre as duas pelo switcher de org)')
    console.log(`${line}\n`)
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n❌ Seed falhou:', err)
    console.error('\nO emulator está rodando? Suba com `pnpm db:start` antes.\n')
    process.exit(1)
  })

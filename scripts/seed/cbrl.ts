// "cbrl" — Kayron's own company, the maker of Oilio, modelled as an org that
// SELLS Oilio: the catalog is the Oilio plans (Pro / Avançado, monthly &
// annual), the "customers" are the businesses that subscribe, and the domain
// `subscription`s carry the real revenue across a full billing lifecycle
// (pending/trial, active, past_due, voluntarily cancelled, churned-by-dunning).
// Against that revenue sit the company's near-real fixed costs (Starlink,
// Agilize accounting, GCP, Anthropic, Google Workspace, domains), captured with
// a versioned vigência so the Razão produces them by competence and the
// break-even reads against actual overhead.
//
// Kayron is the sole member (owner). Everything is written through the canonical
// event-first path (org-base primitives), with fixed ids so a re-run reproduces
// the exact same org (idempotent after the reset).

import { DEFAULT_UNIT_TIMEZONE, type FixedCost, type SubscriptionPlan } from '@/domain'
import { firstInstantOfMonthUtc, toOrgMonth } from '@/domain/utils/competence-month'
import {
  agendaAlwaysOpen,
  buildAddress,
  buildOrg,
  buildSubscriptionPlan,
  buildUnit,
} from '@/shared/fixtures/seed-domain-builders'
import { ensureAuthIdentity } from './auth'
import {
  seedCustomer,
  seedFixedCost,
  seedOrgBilling,
  seedOrgWithOwner,
  seedPlan,
  seedSubscription,
  seedSubscriptionCharges,
  seedUnit,
} from './org-base'
import { daysFromNow, now } from './runtime'

const ORG_ID = 'seed-org-cbrl'
const OWNER = {
  uid: 'seed-owner-cbrl',
  email: 'kayron@cbrl.local',
  displayName: 'Kayron Cabral',
  mobile: '5511922220000',
}

const UNIT_MATRIZ = 'seed-cbrl-unit-matriz'

// The four Oilio plans cbrl sells, mirroring the real SaaS tiers
// (Pro / Avançado) across monthly & annual cycles. Prices are plausible BRL
// per-org monthly/annual (annual ≈ 10× monthly — two months free).
const PLAN_PRO_MENSAL = 'seed-cbrl-plan-pro-mensal'
const PLAN_PRO_ANUAL = 'seed-cbrl-plan-pro-anual'
const PLAN_ADV_MENSAL = 'seed-cbrl-plan-adv-mensal'
const PLAN_ADV_ANUAL = 'seed-cbrl-plan-adv-anual'

export async function seedCbrl(): Promise<void> {
  // — Org + owner (Kayron logs in) —
  await ensureAuthIdentity(OWNER)
  await seedOrgWithOwner({
    org: buildOrg(ORG_ID, OWNER.uid, now, {
      name: 'cbrl',
      slug: 'cbrl',
      vertical: 'other',
      website: 'https://cbrl.dev',
    }),
    owner: OWNER,
    now,
  })

  // Assinatura Oilio: cbrl dogfoods its own product on Avançado (single unit →
  // unitQuantity 1), so every paid surface is unlocked while it operates.
  await seedOrgBilling({
    orgId: ORG_ID,
    orgName: 'cbrl',
    tier: 'advanced',
    billingCycle: 'monthly',
    unitQuantity: 1,
    actorId: OWNER.uid,
    now,
  })

  // — Single unit (the company HQ), where every fixed cost is anchored —
  await seedUnit(
    buildUnit(UNIT_MATRIZ, ORG_ID, now, {
      name: 'Matriz',
      slug: 'matriz',
      address: buildAddress({ neighborhood: 'Centro', street: 'Rua da Tecnologia' }),
      agenda: agendaAlwaysOpen(),
    }),
    OWNER.uid,
  )

  // — Catalog = the Oilio plans cbrl sells (subscription plans) —
  const proMensal = buildSubscriptionPlan(PLAN_PRO_MENSAL, ORG_ID, now, {
    name: 'Oilio Pro (mensal)',
    description: 'Plano Pro — cobrança mensal por organização.',
    priceCents: 8900,
    billingCycle: 'monthly',
    usageLimit: { kind: 'unlimited' },
  })
  const proAnual = buildSubscriptionPlan(PLAN_PRO_ANUAL, ORG_ID, now, {
    name: 'Oilio Pro (anual)',
    description: 'Plano Pro — cobrança anual (dois meses grátis).',
    priceCents: 89000,
    billingCycle: 'annual',
    usageLimit: { kind: 'unlimited' },
  })
  const advMensal = buildSubscriptionPlan(PLAN_ADV_MENSAL, ORG_ID, now, {
    name: 'Oilio Avançado (mensal)',
    description: 'Plano Avançado — cobrança mensal por organização.',
    priceCents: 14900,
    billingCycle: 'monthly',
    usageLimit: { kind: 'unlimited' },
  })
  const advAnual = buildSubscriptionPlan(PLAN_ADV_ANUAL, ORG_ID, now, {
    name: 'Oilio Avançado (anual)',
    description: 'Plano Avançado — cobrança anual (dois meses grátis).',
    priceCents: 149000,
    billingCycle: 'annual',
    usageLimit: { kind: 'unlimited' },
  })
  const plans: SubscriptionPlan[] = [proMensal, proAnual, advMensal, advAnual]
  for (const plan of plans) await seedPlan(plan, OWNER.uid)

  // — Customers = the businesses subscribing to Oilio. Every client paid on
  // signup (the first charge is settled the moment they subscribe — no free
  // trial, no pay-at-the-end), so no subscription lingers unpaid. The variety
  // that remains is what happens AFTER that first paid cycle: most renew
  // (active), one fell behind on a later renewal (past_due), one cancelled
  // (cancelled). Whether the domain should even allow trial/pending/pay-later
  // is under review — see cbrl/cbrl#1391 (subscription charge timing).
  const clients: Array<{
    id: string
    name: string
    mobile: string
    plan: SubscriptionPlan
    state: 'active' | 'past_due' | 'cancelled'
  }> = [
    {
      id: 'barbearia-ze',
      name: 'Barbearia do Zé',
      mobile: '5511944440001',
      plan: advMensal,
      state: 'active',
    },
    {
      id: 'studio-ana',
      name: 'Studio Ana',
      mobile: '5511944440002',
      plan: proMensal,
      state: 'active',
    },
    {
      id: 'auto-brilho',
      name: 'Auto Brilho Lava-Rápido',
      mobile: '5511944440003',
      plan: advAnual,
      state: 'active',
    },
    {
      id: 'espaco-lea',
      name: 'Espaço Léa',
      mobile: '5511944440004',
      plan: proMensal,
      state: 'active',
    },
    {
      id: 'corte-nobre',
      name: 'Corte Nobre',
      mobile: '5511944440005',
      plan: proMensal,
      state: 'past_due',
    },
    {
      id: 'velho-oeste',
      name: 'Barbearia Velho Oeste',
      mobile: '5511944440006',
      plan: advMensal,
      state: 'cancelled',
    },
  ]

  for (const c of clients) {
    const customerId = `seed-cbrl-cust-${c.id}`
    const userId = `${customerId}-user`
    await seedCustomer({
      id: customerId,
      orgId: ORG_ID,
      userId,
      displayName: c.name,
      mobile: c.mobile,
      birthDate: null,
      now,
      actorId: OWNER.uid,
    })

    const subscriptionId = `seed-cbrl-sub-${c.id}`
    // Annual subscriptions renew a year out; monthly ones a month out. A cancelled
    // client keeps its dates (the cancel event nulls nextChargeDate itself).
    const periodDays = c.plan.billingCycle === 'annual' ? 365 : 30
    const periodEnd = daysFromNow(periodDays)
    const nextPeriodEnd = daysFromNow(periodDays * 2)
    await seedSubscription({
      id: subscriptionId,
      orgId: ORG_ID,
      unitId: UNIT_MATRIZ,
      customerId,
      customerUserId: userId,
      plan: c.plan,
      periodStart: now,
      periodEnd,
      nextChargeDate: periodEnd,
      actorId: OWNER.uid,
    })
    // Every client paid on signup: a real first `charge` (created → paid) plus
    // the settle event, then the state diverges on the next cycle (renew /
    // failed-charge / cancel). This is what populates the subscription's charge
    // history and the financial surface.
    await seedSubscriptionCharges({
      orgId: ORG_ID,
      subscriptionId,
      unitId: UNIT_MATRIZ,
      customerId,
      amountCents: c.plan.priceCents,
      periodStart: now,
      periodEnd,
      nextPeriodEnd,
      state: c.state,
      actorId: OWNER.uid,
      now,
    })
  }

  // — Fixed costs (near-real BRL overhead), anchored on the HQ unit and vigente
  // since the org's first competence month so the Razão produces them across the
  // whole window. Accounting is a financial expense; the rest is administrative.
  const tz = DEFAULT_UNIT_TIMEZONE
  const effectiveFrom = firstInstantOfMonthUtc(toOrgMonth(now, tz), tz)
  const costs: Array<{
    key: string
    name: string
    amountCents: number
    category: FixedCost['category']
  }> = [
    { key: 'starlink', name: 'Starlink', amountCents: 25000, category: 'expense_admin' },
    {
      key: 'agilize',
      name: 'Contabilidade Agilize',
      amountCents: 6500,
      category: 'expense_financial',
    },
    {
      key: 'gcp',
      name: 'Google Cloud (Cloud Run + SQL + LB)',
      amountCents: 45000,
      category: 'expense_admin',
    },
    { key: 'anthropic', name: 'Anthropic (Claude)', amountCents: 50000, category: 'expense_admin' },
    { key: 'workspace', name: 'Google Workspace', amountCents: 4600, category: 'expense_admin' },
    // Domínios são cobrados por ano (R$40/ano); rateado por competência mensal.
    {
      key: 'dominios',
      name: 'Domínios (rateio anual)',
      amountCents: 333,
      category: 'expense_admin',
    },
  ]
  for (const cost of costs) {
    const id = `seed-cbrl-cost-${cost.key}`
    const fixedCost: FixedCost = {
      id,
      orgId: ORG_ID,
      unitId: UNIT_MATRIZ,
      seriesId: id,
      name: cost.name,
      category: cost.category,
      amountCents: cost.amountCents,
      effectiveFrom,
      effectiveTo: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await seedFixedCost(fixedCost, OWNER.uid)
  }
}

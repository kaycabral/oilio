// Idempotent sync of the Stripe catalog (Products + graduated Prices) for the
// Assinatura Oilio (SaaS billing, lojista → Oilio). ONE declarative source of
// truth → upsert into whatever account STRIPE_SECRET_KEY points at (test OR
// live — the script is environment-agnostic by design). This is how the test
// catalog gets replicated to live without hand-creating objects in the
// dashboard, so test and prod never drift.
//
// Canonical prices: docs/stripe-setup.md (derived from the Wiki PRD
// `Produto/PRD-Monetizacao-SaaS` §5). Graduated per-unit: 1st unit base price,
// each extra unit at the marginal price; Stripe computes the total from the
// checkout `quantity`.
//
// Idempotency contract: every managed object carries `metadata.managed_by =
// 'oilio-sync'` plus `tier`/`cycle`. The sync matches on that metadata (NOT on
// name/id), so re-running never duplicates — it finds the existing object and
// reconciles it. Prices are immutable in Stripe (amount/interval can't be
// edited), so a changed amount means: create the new Price, and the old one is
// left active but unreferenced (report it — never auto-archive money objects).
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... tsx scripts/sync-stripe-catalog.ts           # dry-run (default)
//   STRIPE_SECRET_KEY=sk_live_... tsx scripts/sync-stripe-catalog.ts --apply   # actually write
//
// Dry-run prints the plan (create/reuse per object) and writes nothing. --apply
// performs the creates and prints the resulting price ids ready for the env vars.

import { requireEnv } from '@cbrl/env'
import Stripe from 'stripe'

const MANAGED_BY = 'oilio-sync'
// Pinned, matches stripe-client.ts.
const API_VERSION = '2026-06-24.dahlia'

type Cycle = 'monthly' | 'annual'

type PriceSpec = {
  cycle: Cycle
  interval: Stripe.PriceCreateParams.Recurring.Interval
  // Graduated tiers in CENTS (BRL). up_to:1 = base (1st unit), then the marginal.
  baseUnitAmount: number
  extraUnitAmount: number
  // The env var this price id feeds, printed after --apply for convenience.
  envVar: string
}

type ProductSpec = {
  tier: 'pro' | 'advanced'
  name: string
  description: string
  prices: PriceSpec[]
}

// Declarative catalog — the single source of truth. Annual = 2 months free
// (monthly × 10). Amounts in cents. Keep in lockstep with stripe-setup.md.
const CATALOG: ProductSpec[] = [
  {
    tier: 'pro',
    name: 'Oilio Pro',
    description:
      'Assinatura Oilio — plano Pro (cobrança por unidade): profissionais ilimitados, assinaturas recorrentes, comissões, relatórios de vendas e copiloto de meta de lucro.',
    prices: [
      {
        cycle: 'monthly',
        interval: 'month',
        // R$ 89 base, R$ 59 extra.
        baseUnitAmount: 8900,
        extraUnitAmount: 5900,
        envVar: 'STRIPE_PRICE_PRO_MONTHLY',
      },
      {
        cycle: 'annual',
        interval: 'year',
        // R$ 890/ano base (R$ 74/mês × 10), R$ 590/ano extra (R$ 49/mês × 10).
        baseUnitAmount: 89000,
        extraUnitAmount: 59000,
        envVar: 'STRIPE_PRICE_PRO_ANNUAL',
      },
    ],
  },
  {
    tier: 'advanced',
    name: 'Oilio Avançado',
    description:
      'Assinatura Oilio — plano Avançado (cobrança por unidade): tudo do Pro mais suporte prioritário.',
    prices: [
      {
        cycle: 'monthly',
        interval: 'month',
        // R$ 149 base, R$ 99 extra.
        baseUnitAmount: 14900,
        extraUnitAmount: 9900,
        envVar: 'STRIPE_PRICE_ADVANCED_MONTHLY',
      },
      {
        cycle: 'annual',
        interval: 'year',
        // R$ 1.490/ano base (R$ 124/mês × 10), R$ 990/ano extra (R$ 82/mês × 10).
        baseUnitAmount: 149000,
        extraUnitAmount: 99000,
        envVar: 'STRIPE_PRICE_ADVANCED_ANNUAL',
      },
    ],
  },
]

const apply = process.argv.includes('--apply')

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

// Find the Product this sync manages for a tier, or null. Matches on our
// metadata, not the name — a manually-renamed product is still "ours".
async function findManagedProduct(stripe: Stripe, tier: string): Promise<Stripe.Product | null> {
  // search is eventually-consistent but fine here (catalog changes are rare and
  // this runs deliberately, not in a hot path).
  const res = await stripe.products.search({
    query: `active:'true' AND metadata['managed_by']:'${MANAGED_BY}' AND metadata['tier']:'${tier}'`,
  })
  return res.data[0] ?? null
}

async function findManagedPrice(
  stripe: Stripe,
  productId: string,
  tier: string,
  cycle: Cycle,
): Promise<Stripe.Price | null> {
  const res = await stripe.prices.search({
    query: `active:'true' AND product:'${productId}' AND metadata['managed_by']:'${MANAGED_BY}' AND metadata['tier']:'${tier}' AND metadata['cycle']:'${cycle}'`,
  })
  const hit = res.data[0]
  if (!hit) return null
  // `prices.search` (and list) omit graduated `tiers` — they only come back on a
  // retrieve with an explicit expand. Without this, priceMatches() compares
  // against undefined tiers and reports a false MISMATCH, so --apply would
  // duplicate every Price. Re-fetch with the tiers expanded.
  return stripe.prices.retrieve(hit.id, { expand: ['tiers'] })
}

// Does an existing Price already match the spec's amounts/interval? Prices are
// immutable, so a mismatch means we must create a NEW one (never edit).
function priceMatches(price: Stripe.Price, spec: PriceSpec): boolean {
  if (price.currency !== 'brl') return false
  if (price.recurring?.interval !== spec.interval) return false
  if (price.billing_scheme !== 'tiered' || price.tiers_mode !== 'graduated') return false
  const tiers = price.tiers ?? []
  const base = tiers.find((t) => t.up_to === 1)?.unit_amount
  // Stripe returns the `up_to: 'inf'` tier as `up_to: null`.
  const extra = tiers.find((t) => t.up_to === null)?.unit_amount
  return base === spec.baseUnitAmount && extra === spec.extraUnitAmount
}

async function ensureProduct(stripe: Stripe, spec: ProductSpec): Promise<string> {
  const existing = await findManagedProduct(stripe, spec.tier)
  if (existing) {
    log(`  product [${spec.tier}] reuse ${existing.id} ("${existing.name}")`)
    return existing.id
  }
  if (!apply) {
    log(`  product [${spec.tier}] WOULD CREATE "${spec.name}"`)
    return `(dry-run:${spec.tier})`
  }
  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { managed_by: MANAGED_BY, tier: spec.tier },
  })
  log(`  product [${spec.tier}] CREATED ${created.id}`)
  return created.id
}

// Returns [envVar, priceId] for reporting; priceId is a placeholder in dry-run.
async function ensurePrice(
  stripe: Stripe,
  productId: string,
  tier: string,
  spec: PriceSpec,
): Promise<[string, string]> {
  // In dry-run with a placeholder product id we can't query prices; report intent.
  const existing = productId.startsWith('(dry-run')
    ? null
    : await findManagedPrice(stripe, productId, tier, spec.cycle)

  if (existing && priceMatches(existing, spec)) {
    log(`  price [${tier}/${spec.cycle}] reuse ${existing.id}`)
    return [spec.envVar, existing.id]
  }
  if (existing && !priceMatches(existing, spec)) {
    log(
      `  price [${tier}/${spec.cycle}] MISMATCH on ${existing.id} (amount/interval changed) → will create a new Price; archive the old one manually after repointing env`,
    )
  }
  if (!apply) {
    log(
      `  price [${tier}/${spec.cycle}] WOULD CREATE graduated ${spec.baseUnitAmount}/${spec.extraUnitAmount} BRL ${spec.interval}`,
    )
    return [spec.envVar, `(dry-run:${tier}/${spec.cycle})`]
  }
  const created = await stripe.prices.create({
    product: productId,
    currency: 'brl',
    nickname: `${tier} ${spec.cycle} (por unidade, graduated)`,
    recurring: { interval: spec.interval },
    billing_scheme: 'tiered',
    tiers_mode: 'graduated',
    tiers: [
      { up_to: 1, unit_amount: spec.baseUnitAmount },
      { up_to: 'inf', unit_amount: spec.extraUnitAmount },
    ],
    metadata: { managed_by: MANAGED_BY, tier, cycle: spec.cycle },
  })
  log(`  price [${tier}/${spec.cycle}] CREATED ${created.id}`)
  return [spec.envVar, created.id]
}

async function main(): Promise<void> {
  const secret = requireEnv('STRIPE_SECRET_KEY')
  const stripe = new Stripe(secret, { apiVersion: API_VERSION })
  const mode = apply ? 'APPLY' : 'DRY-RUN'
  // Surface which environment we're pointed at (test vs live) from the key
  // prefix — a guard against accidentally applying to the wrong account.
  const live = secret.includes('_live_')
  log(`Stripe catalog sync — ${mode} — ${live ? 'LIVE' : 'TEST'} mode`)
  log('')

  const envLines: [string, string][] = []
  for (const product of CATALOG) {
    log(`${product.name}:`)
    const productId = await ensureProduct(stripe, product)
    for (const price of product.prices) {
      envLines.push(await ensurePrice(stripe, productId, product.tier, price))
    }
    log('')
  }

  log('Price ids for the env (test → .env.local, live → Secret Manager / --set-env-vars):')
  for (const [envVar, id] of envLines) log(`  ${envVar}=${id}`)
  if (!apply) {
    log('')
    log('DRY-RUN — nothing was written. Re-run with --apply to create missing objects.')
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `sync-stripe-catalog failed: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})

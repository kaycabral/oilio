// Dev seed for local manual testing — the Postgres event-store rebuild of the
// rich pre-cutover demo (the Firestore seed removed in #1202).
//
// Writes through the SAME canonical path as production: `emitEvent` /
// `commitSaga` over the Postgres event store (reducer → projection in one ACID
// tx), the PII sidecars + the global `users` table off the event payload, and
// Supabase Auth identities (local stack) for the personas a tester logs in as. NO raw INSERTs,
// no dual-writes, no `SecurityContext` bypass — the RLS GUC is derived per-write
// from each `AggregateRef.orgId`.
//
// It seeds five isolated orgs (paridade with the old seed):
//   • Barbearia do Zé   — the rich org (units across all agenda modes, catalog,
//                          member operations via the invite cascade, customers,
//                          subscription, appointments, agenda blocks, cash).
//   • Pizzaria do Tonho  — retail isolation org with closed sales.
//   • Comércio Esquina   — retail isolation org with closed sales.
//   • Studio Ana Informal + Ana Fiscal ME — the informal vs formalized fiscal pair.
//
// The whole run is idempotent: it TRUNCATEs the local DB first (guarded to
// localhost) and uses fixed ids + a frozen clock, so re-running reproduces the
// exact same state. Prerequisite: a migrated local `oilio` Postgres
// (`pnpm db:start`).

import { seedBarbearia } from './seed/barbearia'
import { seedCbrl } from './seed/cbrl'
import { seedFormalizacao } from './seed/formalizacao'
import { seedComercio, seedPizzaria } from './seed/pizzaria-comercio'
import { resetEventStore } from './seed/reset'
import { bootSeed, shutdownSeed } from './seed/runtime'

async function main(): Promise<void> {
  const pool = bootSeed()

  console.log('▸ resetting local oilio event store…')
  await resetEventStore(pool)

  console.log('▸ seeding Barbearia do Zé (rich org)…')
  await seedBarbearia()

  console.log('▸ seeding Pizzaria do Tonho (isolation)…')
  await seedPizzaria()

  console.log('▸ seeding Comércio Esquina (isolation)…')
  await seedComercio()

  console.log('▸ seeding formalization orgs (Ana Fiscal)…')
  await seedFormalizacao()

  console.log('▸ seeding cbrl (maker of Oilio — SaaS revenue + fixed costs)…')
  await seedCbrl()

  console.log(
    [
      '',
      '✓ seed complete — 6 orgs.',
      '  Login (local stack only, ENABLE_TEST_AUTH=true): POST /api/e2e-signin with one',
      '  of the emails below and password "oilio-local-dev" (see README § Scripts).',
      '  Each maps to a fixed seeded uid:',
      '    • dev@cbrl.local        — Zé Owner (Barbearia, owner)',
      '    • ze.pro@cbrl.local     — Zé Barbeiro (member operator)',
      '    • recep@cbrl.local      — Paula (receptionist)',
      '    • cliente@cbrl.local    — Cliente Demo (customer)',
      '    • ana.fiscal@cbrl.local — Ana Fiscal (informal + formalized orgs)',
      '    • kayron@cbrl.local     — Kayron (cbrl, maker of Oilio)',
    ].join('\n'),
  )
}

main()
  .then(() => shutdownSeed())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('✕ seed failed:', err)
    await shutdownSeed().catch(() => undefined)
    process.exit(1)
  })

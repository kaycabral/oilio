// Dev seed for local manual testing ("Barbearia do Zé").
//
// DEFERRED (Postgres cutover #1202): the previous seed wrote the whole demo org
// to the Firestore emulator via `getAdminFirestore`, which no longer exists —
// oilio's data lives in the Postgres event store now (Firebase is auth-only).
// Re-seeding the demo org against Postgres (emitEvent over the event store +
// the *_pii sidecars + org_links) is its own workstream and is tracked as a
// follow-up; `pnpm local` skips seeding for oilio in the meantime
// (scripts/local-up.mjs gates on `usesFirestore`).
//
// This stub keeps `pnpm db:seed` resolvable (no dangling import of the removed
// getAdminFirestore) and fails loudly with the reason rather than silently
// doing nothing, so nobody mistakes "ran, no error" for "seeded".

console.error(
  [
    'oilio dev seed is not available yet.',
    '',
    'The Firestore-emulator seed was removed in the Postgres cutover (#1202).',
    'A Postgres dev seed is a follow-up; until then, run the app against an',
    'empty local Postgres and create data through the UI/flows.',
  ].join('\n'),
)
process.exit(1)

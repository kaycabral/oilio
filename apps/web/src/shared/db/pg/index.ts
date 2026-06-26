/**
 * Server-only barrel for the oilio relational event store (brief 0057).
 *
 * Importing this opens a path to the `pg` pool — it must NEVER reach the client
 * bundle (the boundary lesson from `@cbrl/product`: `pg` pulls `dns`/`fs` and
 * breaks `next build`). Consumers are the Postgres persistence Layer, the
 * migration runner, and integration tests — all server-side.
 */
export { runEventStoreMigrations } from './migrate'
export { closeEventStoreDb, getEventStoreDb, initEventStore } from './pool'
export * as eventStoreSchema from './schema'

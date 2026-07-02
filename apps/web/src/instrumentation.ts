/**
 * Next.js instrumentation — `register()` runs ONCE per server instance, before
 * any request is served (Next docs: instrumentation.js file convention).
 *
 * We use it to eager-open the Postgres pools at boot. In production they use the
 * Cloud SQL IAM connector (async), so opening here keeps the ~270 synchronous
 * domain call-sites free of the connector's async-ness AND makes a bad
 * credential / network / IAM config fail at STARTUP (visible in the deploy +
 * health check) rather than on a user's first request.
 *
 * Node-only: the `pg` driver can't run on the Edge runtime, so the imports are
 * gated on `NEXT_RUNTIME` and loaded dynamically (never bundled into Edge).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const [{ initEventStore }, { initProductDb }] = await Promise.all([
    import('@/shared/db/pg'),
    import('@cbrl/product'),
  ])
  // Open both logical databases on the shared Cloud SQL instance. Parallel — the
  // two connections are independent.
  await Promise.all([initEventStore(), initProductDb()])
}

import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

import { STRIPE_SECRET_KEY } from '../tests/e2e/helpers/secrets'
import { readLocalSupabase } from './local-supabase'
import { applyMigrations } from './run-migrations'

/**
 * Playwright E2E against the LOCAL Supabase stack (`pnpm db:start` first; CI
 * runs it in the job) and a per-run stripe-mock (`docker/stripe-mock.compose.yaml`).
 * Applies pending migrations, picks free ports, and runs Playwright with two
 * database roles:
 *  - the Next server under test connects as `oilio_app` (no BYPASSRLS), so RLS
 *    binds exactly as in production (`E2E_APP_DATABASE_URL`);
 *  - the spec helpers seed fixtures as the `postgres` owner
 *    (`OILIO_DATABASE_URL` / `DATABASE_URL` in the Playwright process).
 * The app's Stripe client talks to stripe-mock (`STRIPE_API_BASE`). A billing
 * call that fails server-side logs an error and degrades the UI, which a spec
 * may not notice, so any such log line fails the run.
 * Extra args go straight to `playwright test`.
 */
const STRIPE_COMPOSE = path.resolve(import.meta.dirname, '../docker/stripe-mock.compose.yaml')

const BILLING_ERROR_SCOPES = [
  'billing-details',
  'getUnitAdditionCost',
  'syncStripeSubscriptionQuantity',
  'startCheckout',
  'cancelSubscription',
  'stripe-webhook',
]

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function compose(project: string, port: number, args: string[]): number {
  const res = spawnSync('docker', ['compose', '-p', project, '-f', STRIPE_COMPOSE, ...args], {
    stdio: 'inherit',
    env: { ...process.env, STRIPE_MOCK_PORT: String(port) },
  })
  if (res.error) throw res.error
  return res.status ?? 1
}

async function waitForStripeMock(apiBase: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBase}/v1/balance`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    }).catch(() => null)
    if (res?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`stripe-mock did not answer on ${apiBase} within 60s`)
}

function isBillingError(line: string): boolean {
  if (!line.includes('"level":"error"')) return false
  return BILLING_ERROR_SCOPES.some((scope) => line.includes(`"scope":"${scope}"`))
}

function runPlaywright(
  env: NodeJS.ProcessEnv,
): Promise<{ status: number; billingErrors: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
    })
    const billingErrors: string[] = []
    const scan = (sink: NodeJS.WriteStream) => {
      let pending = ''
      return (chunk: Buffer) => {
        sink.write(chunk)
        const lines = (pending + chunk.toString('utf8')).split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) if (isBillingError(line)) billingErrors.push(line)
      }
    }
    child.stdout.on('data', scan(process.stdout))
    child.stderr.on('data', scan(process.stderr))
    child.on('error', reject)
    child.on('close', (code) => resolve({ status: code ?? 1, billingErrors }))
  })
}

async function main(): Promise<number> {
  const local = readLocalSupabase()
  await applyMigrations(local.ownerDbUrl)
  const port = process.env.E2E_PORT ?? String(await freePort())

  const stripePort = await freePort()
  const stripeProject = `oilio-stripe-mock-${stripePort}`
  const stripeApiBase = `http://127.0.0.1:${stripePort}`
  if (compose(stripeProject, stripePort, ['up', '-d']) !== 0) {
    throw new Error('stripe-mock failed to start')
  }
  const stopStripeMock = () => compose(stripeProject, stripePort, ['down', '--remove-orphans'])
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopStripeMock()
      process.exit(130)
    })
  }

  try {
    await waitForStripeMock(stripeApiBase)
    console.log(
      `▸ E2E on the local Supabase stack, Next on :${port}, stripe-mock on :${stripePort}`,
    )
    const { status, billingErrors } = await runPlaywright({
      ...process.env,
      E2E_PORT: port,
      STRIPE_API_BASE: stripeApiBase,
      NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      SUPABASE_SECRET_KEY: local.secretKey,
      OILIO_DATABASE_URL: local.ownerDbUrl,
      DATABASE_URL: local.ownerDbUrl,
      E2E_APP_DATABASE_URL: local.appDbUrl,
    })
    if (billingErrors.length > 0) {
      console.error(
        `\n✖ ${billingErrors.length} billing error(s) logged by the server under test:\n` +
          billingErrors.map((line) => `  ${line.slice(0, 400)}`).join('\n'),
      )
      return status === 0 ? 1 : status
    }
    return status
  } finally {
    stopStripeMock()
  }
}

main().then(
  (status) => process.exit(status),
  (err: unknown) => {
    console.error(err)
    process.exit(1)
  },
)

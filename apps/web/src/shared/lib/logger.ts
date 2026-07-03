import { getRequestContext } from './request-context'

type Level = 'debug' | 'info' | 'warn' | 'error'

// Cloud Logging reads the top-level `severity` field to colour/filter entries
// natively (a Cloud Run stdout JSON line becomes a structured entry). We keep the
// original `level` too — internal specs/readers may match on it — and map each
// level to the LogSeverity name Cloud Logging recognises (brief 0086 AC-01).
const SEVERITY: Record<Level, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
}

// Defence in depth (brief 0086 AC-03): a call site should never pass PII in
// `meta`, but if a known-PII key slips through we redact its value rather than
// serialise it — the log must not become a new disclosure vector (LGPD). The
// primary guard is the call sites; this is the backstop.
const PII_KEYS = new Set(['whatsapp', 'email', 'document', 'cpf', 'cnpj', 'phone'])

function redactPii(meta: Record<string, unknown>): Record<string, unknown> {
  let hit = false
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (PII_KEYS.has(key.toLowerCase()) && value != null) {
      safe[key] = '[redacted]'
      hit = true
    } else {
      safe[key] = value
    }
  }
  return hit ? safe : meta
}

// In production (Cloud Run) emit one JSON line per entry: Cloud Logging renders it
// legibly for a human in the console AND it stays machine-queryable via `gcloud`
// (brief 0086 AC-01b). In dev a raw JSON line is unreadable in the terminal, so
// emit a single coloured pretty line instead. The choice is by environment, read
// per-emit (not memoised) so it honours the runtime env — call sites never branch.
function jsonOutput(): boolean {
  // JSON in production (Cloud Run) and under test (so specs assert the structured
  // shape); pretty only in interactive dev.
  const env = process.env.NODE_ENV
  return env === 'production' || env === 'test'
}

const DEV_COLOR: Record<Level, string> = {
  debug: '\x1b[90m', // grey
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
}
const RESET = '\x1b[0m'

function formatPretty(
  level: Level,
  message: string,
  ts: string,
  rest: Record<string, unknown>,
): string {
  const time = ts.slice(11, 19) // HH:MM:SS
  const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `${DEV_COLOR[level]}${time} ${SEVERITY[level]}${RESET} ${message}${tail}`
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  // Implicit request context (correlationId / orgId) injected from the active
  // AsyncLocalStorage scope — absent at boot / outside a request (degrades clean).
  const ctx = getRequestContext()
  const context: Record<string, unknown> = {}
  if (ctx?.correlationId) context.correlationId = ctx.correlationId
  if (ctx?.orgId) context.orgId = ctx.orgId
  const safeMeta = meta ? redactPii(meta) : {}

  const out = level === 'error' || level === 'warn' ? console.error : console.log
  if (jsonOutput()) {
    out(JSON.stringify({ severity: SEVERITY[level], level, message, ts, ...context, ...safeMeta }))
  } else {
    out(formatPretty(level, message, ts, { ...context, ...safeMeta }))
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
}

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
const PII_KEYS = new Set(['whatsapp', 'mobile', 'email', 'document', 'cpf', 'cnpj', 'phone'])

// An `Error` serialises to `{}` under JSON.stringify because `message`/`stack`
// are non-enumerable — which would silently drop the very cause the log exists to
// capture. Normalise any Error (at any depth) to a plain object carrying its
// name/message/stack (+ a pg `code`/SQLSTATE when present) BEFORE serialising.
function normalizeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message }
  if (err.stack) out.stack = err.stack
  // pg `DatabaseError` carries `code` (SQLSTATE); surface it for diagnosis. Its
  // `detail`/`where` may embed PII, so they are deliberately NOT copied here.
  // `in` + a `Record` read (no assertion): Error has no static `code` field.
  if ('code' in err) {
    const code: unknown = Reflect.get(err, 'code')
    if (typeof code === 'string') out.code = code
  }
  return out
}

// One recursive pass over `meta`: normalise Errors and redact known-PII keys at
// any depth. A PII value nested inside a non-PII key (e.g. a pg error's `detail`
// under `err`) is why redaction must recurse, not just check top-level keys.
function sanitize(value: unknown, keyIsPii: boolean): unknown {
  if (keyIsPii && value != null) return '[redacted]'
  if (value instanceof Error) return sanitize(normalizeError(value), false)
  if (Array.isArray(value)) return value.map((v) => sanitize(v, false))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitize(v, PII_KEYS.has(k.toLowerCase()))
    }
    return out
  }
  return value
}

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    out[key] = sanitize(value, PII_KEYS.has(key.toLowerCase()))
  }
  return out
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

// ANSI colours per level for the dev pretty line: grey / cyan / yellow / red.
const DEV_COLOR: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'

function formatPretty(
  level: Level,
  message: string,
  ts: string,
  rest: Record<string, unknown>,
): string {
  // `ts` is an ISO string; slice out the HH:MM:SS clock portion.
  const time = ts.slice(11, 19)
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
  const safeMeta = meta ? sanitizeMeta(meta) : {}

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

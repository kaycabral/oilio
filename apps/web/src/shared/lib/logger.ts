import { getRequestContext } from './request-context'

type Level = 'debug' | 'info' | 'warn' | 'error'

const SEVERITY: Record<Level, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
}

const PII_KEYS = new Set(['whatsapp', 'mobile', 'email', 'document', 'cpf', 'cnpj', 'phone'])

function normalizeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message }
  if (err.stack) out.stack = err.stack
  if ('code' in err) {
    const code: unknown = Reflect.get(err, 'code')
    if (typeof code === 'string') out.code = code
  }
  return out
}

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

function jsonOutput(): boolean {
  const env = process.env.NODE_ENV
  return env === 'production' || env === 'test'
}

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
  const time = ts.slice(11, 19)
  const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `${DEV_COLOR[level]}${time} ${SEVERITY[level]}${RESET} ${message}${tail}`
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
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

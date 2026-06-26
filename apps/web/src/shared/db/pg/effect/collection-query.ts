import type { QueryConstraint } from '@/domain/effect'

/**
 * Translate the domain's `QueryConstraint[]` (the Firestore-shaped query vocabulary
 * the pure aggregates pass through `PersistencePort.getDocs`) into a parameterized
 * SQL `WHERE … ORDER BY … LIMIT …` tail for a typed projection table (brief 0062,
 * the notifications/cron Postgres cutover).
 *
 * Shared by every typed projector that supports a collection scan (`list`) so the
 * constraint translation lives in ONE place; each projector owns only its table
 * name, column set and `rowToDoc` (its Row type stays local — no cast leaks).
 *
 * Mapping (only the shapes the domain/cron reads actually use):
 *   - `where field == value`  → `field = $n`     (value `null` → `field IS NULL`)
 *   - `where field in [...]`  → `field = ANY($n)` (empty list → `false`, matches none)
 *   - `limit n`               → `LIMIT n`
 *   - `orderBy field dir`     → `ORDER BY field {ASC|DESC}`
 *
 * The camelCase domain field is mapped to its snake_case column via `camelToSnake`
 * and VALIDATED against the projector's `columns`: an unknown field throws (loud),
 * never a silent wrong/empty result. An unsupported `op` throws too.
 */

export function camelToSnake(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

export type CollectionQueryTail = {
  /** SQL fragment appended after the base `SELECT … FROM table [WHERE org_id = $1]`. */
  readonly sql: string
  /** Bound parameters for the fragment, continuing the base statement's `$` sequence. */
  readonly params: unknown[]
}

/**
 * Build the `WHERE`-extension / `ORDER BY` / `LIMIT` tail from the constraints.
 *
 * `startIndex` is the next free `$` placeholder (1-based). When the base query
 * already filters `org_id = $1`, pass `startIndex = 2` and `prefixedWhere = true`
 * so the `where` constraints are joined with `AND`; for a top-level scan with no
 * base predicate, pass `startIndex = 1` and `prefixedWhere = false` so the first
 * `where` opens the clause with `WHERE`.
 */
function resolveColumn(field: string, columns: readonly string[]): string {
  const column = camelToSnake(field)
  if (!columns.includes(column)) {
    throw new Error(`Unsupported query field "${field}" (column "${column}") for collection read`)
  }
  return column
}

// Render a single `where` constraint to its SQL fragment, appending any bound
// parameter to `params`. Returns the next free `$` index. Only the ops the
// domain/cron reads use (`==` incl. `== null`, `in`) are supported; others throw.
function renderWhere(
  c: Extract<QueryConstraint, { kind: 'where' }>,
  columns: readonly string[],
  index: number,
  params: unknown[],
): { fragment: string; nextIndex: number } {
  const column = resolveColumn(c.field, columns)
  if (c.op === '==') {
    if (c.value === null) return { fragment: `${column} IS NULL`, nextIndex: index }
    params.push(c.value)
    return { fragment: `${column} = $${index}`, nextIndex: index + 1 }
  }
  if (c.op === 'in') {
    params.push(c.value)
    return { fragment: `${column} = ANY($${index})`, nextIndex: index + 1 }
  }
  throw new Error(`Unsupported query operator "${c.op}" for collection read`)
}

export function buildCollectionQueryTail(
  constraints: readonly QueryConstraint[],
  columns: readonly string[],
  startIndex: number,
  prefixedWhere: boolean,
): CollectionQueryTail {
  const params: unknown[] = []
  const whereParts: string[] = []
  let orderBy = ''
  let limit = ''
  let nextIndex = startIndex

  for (const c of constraints) {
    if (c.kind === 'where') {
      const rendered = renderWhere(c, columns, nextIndex, params)
      whereParts.push(rendered.fragment)
      nextIndex = rendered.nextIndex
    } else if (c.kind === 'orderBy') {
      const column = resolveColumn(c.field, columns)
      orderBy = ` ORDER BY ${column} ${c.direction === 'desc' ? 'DESC' : 'ASC'}`
    } else {
      limit = ` LIMIT ${c.count}`
    }
  }

  const where =
    whereParts.length > 0 ? (prefixedWhere ? ' AND ' : ' WHERE ') + whereParts.join(' AND ') : ''

  return { sql: `${where}${orderBy}${limit}`, params }
}

import type { QueryConstraint } from '@/domain/effect'

export function camelToSnake(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

export type CollectionQueryTail = {
  readonly sql: string
  readonly params: unknown[]
}

function resolveColumn(field: string, columns: readonly string[]): string {
  const column = camelToSnake(field)
  if (!columns.includes(column)) {
    throw new Error(`Unsupported query field "${field}" (column "${column}") for collection read`)
  }
  return column
}

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

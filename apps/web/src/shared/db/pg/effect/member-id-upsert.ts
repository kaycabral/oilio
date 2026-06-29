// Shared builder for the `member_id`-deriving UPSERT used by the appointment and
// agenda-block projectors (brief 0076 AC-04). Both tables carry a literal
// `member_id` (the membership the performer belongs to) DERIVED in-tx from the
// operational profile via a correlated subquery on `member_operation_id` — the
// same rule expressed once here instead of copy-pasted per projector, so the two
// can't drift (member_id never enters the event payload, so a divergence would
// survive replay and only surface in integration).
//
// The placeholder values the caller binds are the table's base columns (the
// `*_COLUMNS` list, in order); `member_id` is appended as a SQL expression (the
// subquery), NOT a bound value. When `member_operation_id` is NULL (a whole-unit
// agenda block) the subquery yields NULL and `member_id` is NULL in lock-step.

export function buildMemberIdUpsert(table: string, baseColumns: readonly string[]): string {
  const orgIdPlaceholder = `$${baseColumns.indexOf('org_id') + 1}`
  const memberOperationIdPlaceholder = `$${baseColumns.indexOf('member_operation_id') + 1}`
  const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdPlaceholder} AND mo.id = ${memberOperationIdPlaceholder})`

  const insertColumns = [...baseColumns, 'member_id']
  const valueExpressions = [...baseColumns.map((_, i) => `$${i + 1}`), memberIdDerived]
  const conflictSet = insertColumns
    .filter((col) => col !== 'org_id' && col !== 'id')
    .map((col) => `${col} = EXCLUDED.${col}`)
    .join(', ')

  return `
  INSERT INTO ${table} (${insertColumns.join(', ')})
  VALUES (${valueExpressions.join(', ')})
  ON CONFLICT (org_id, id) DO UPDATE SET ${conflictSet}
`
}

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

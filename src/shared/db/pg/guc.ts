import type { PoolClient } from 'pg'

export async function setRlsGucs(
  client: PoolClient,
  org: string | null,
  unit: string,
  memberOperation = '',
): Promise<void> {
  if (org !== null) {
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org', org])
  }
  await client.query('SELECT set_config($1, $2, true)', ['app.current_unit', unit])
  await client.query('SELECT set_config($1, $2, true)', [
    'app.current_member_operation',
    memberOperation,
  ])
}

export async function setSubjectGuc(client: PoolClient, userId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId])
}

import type { AggregateRef } from '@/domain/effect'
import { deletePostgresProjection } from '@/shared/db/pg/effect/postgres-layer'
import 'server-only'

export async function deleteOrgProjectionDoc(ref: AggregateRef): Promise<void> {
  await deletePostgresProjection(ref)
}

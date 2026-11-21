import type { AggregateRef, CollectionRef, QueryConstraint, StoredDoc } from '@/domain/effect'
import type { PoolClient } from 'pg'

export type TypedProjector = {
  readonly read: (client: PoolClient, ref: AggregateRef) => Promise<StoredDoc | null>
  readonly readForUpdate?: (client: PoolClient, ref: AggregateRef) => Promise<StoredDoc | null>
  readonly upsert: (client: PoolClient, ref: AggregateRef, state: StoredDoc) => Promise<void>
  readonly delete: (client: PoolClient, ref: AggregateRef) => Promise<void>
  readonly list?: (
    client: PoolClient,
    ref: CollectionRef,
    constraints: readonly QueryConstraint[],
  ) => Promise<StoredDoc[]>
}

const registry = new Map<AggregateRef['type'], TypedProjector>()

export function registerTypedProjector(
  type: AggregateRef['type'],
  projector: TypedProjector,
): void {
  registry.set(type, projector)
}

export function typedProjectorFor(type: AggregateRef['type']): TypedProjector | undefined {
  return registry.get(type)
}

import { buildReactor, notificationReactions } from '@/domain/aggregates'
import type { EventEnvelope } from '@/domain/effect'
import { FirestoreLayerLive } from '@/shared/db/effect'
import { Effect } from 'effect'

const reactor = buildReactor([...notificationReactions])

export async function dispatchNotificationReactions(
  tag: string,
  actorId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const envelope: EventEnvelope = {
    _tag: tag,
    version: 0,
    timestamp: new Date().toISOString(),
    actorId,
    schemaVersion: 1,
    payload,
  }

  await Effect.runPromise(
    reactor(envelope).pipe(
      Effect.catchAll(() => Effect.void),
      Effect.provide(FirestoreLayerLive),
    ),
  )
}

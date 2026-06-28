import { describe, expect, it } from 'vitest'
import { enrichCustomers } from './customer-read'
import { enrichInvites } from './invite-read'
import { enrichMemberOperations } from './member-operation-read'

/**
 * Unit coverage for the empty-input fast path of the batch-enrich entrypoints of
 * the identity-restante reads (brief 0060, Grupo A). These reads gained a
 * backend-aware Postgres branch; their enrich step still short-circuits on an
 * empty batch WITHOUT touching Firestore/the global users collection, so this
 * path is pure and unit-testable. The populated path (PII merge from `users/` +
 * sidecars) is exercised by the E2E suite against the real backends.
 */

describe('identity-restante reads — empty-batch enrich short-circuits (no I/O)', () => {
  it('enrichMemberOperations([]) returns [] without reading users/PII', async () => {
    await expect(enrichMemberOperations('org-1', [])).resolves.toEqual([])
  })

  it('enrichCustomers([]) returns [] without reading users', async () => {
    await expect(enrichCustomers('org-1', [])).resolves.toEqual([])
  })

  it('enrichInvites([]) returns [] without reading the PII sidecar', async () => {
    await expect(enrichInvites('org-1', [])).resolves.toEqual([])
  })
})

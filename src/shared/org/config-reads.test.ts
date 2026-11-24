import { describe, expect, it } from 'vitest'
import { enrichCustomers } from './customer-read'
import { enrichInvites } from './invite-read'
import { enrichMemberOperations } from './member-operation-read'

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

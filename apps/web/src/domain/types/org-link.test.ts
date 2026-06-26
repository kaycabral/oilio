import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { OrgLink, orgLinkDocPath } from './org-link'

describe('orgLinkDocPath', () => {
  it('builds the reverse-index path under the subject identity doc', () => {
    expect(orgLinkDocPath('uid-1', 'org-9')).toBe('users/uid-1/org_links/org-9')
  })
})

describe('OrgLink schema', () => {
  it('decodes a reference-only link (zero PII)', () => {
    const decoded = Schema.decodeUnknownSync(OrgLink)({
      orgId: 'org-9',
      linkedAt: '2026-06-01T12:00:00.000Z',
    })
    expect(decoded).toEqual({ orgId: 'org-9', linkedAt: '2026-06-01T12:00:00.000Z' })
  })

  it('rejects a payload missing the proof timestamp', () => {
    expect(() => Schema.decodeUnknownSync(OrgLink)({ orgId: 'org-9' })).toThrow()
  })
})

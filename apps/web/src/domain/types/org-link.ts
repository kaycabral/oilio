import { Schema } from 'effect'

export const OrgLink = Schema.mutable(
  Schema.Struct({
    orgId: Schema.String,
    linkedAt: Schema.String,
  }),
)
export type OrgLink = typeof OrgLink.Type

export function orgLinkDocPath(uid: string, orgId: string): string {
  return `users/${uid}/org_links/${orgId}`
}

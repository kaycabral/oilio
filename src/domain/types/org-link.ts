import { Schema, Struct } from 'effect'

export const OrgLink = Schema.Struct({
  orgId: Schema.String,
  linkedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type OrgLink = typeof OrgLink.Type

export function orgLinkDocPath(uid: string, orgId: string): string {
  return `users/${uid}/org_links/${orgId}`
}

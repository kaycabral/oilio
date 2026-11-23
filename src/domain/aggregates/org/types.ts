import type { StoredOrg } from '@/domain/types/org'
import { DEFAULT_ORG_BRANDING } from '@/domain/types/org'

export type OrgState = StoredOrg & { readonly _version: number }

export const INITIAL_ORG_STATE: OrgState = {
  id: '',
  name: '',
  slug: '',
  vertical: 'barbershop',
  ownerUserId: '',
  branding: { ...DEFAULT_ORG_BRANDING },
  createdAt: '',
  updatedAt: '',
  _version: 0,
}

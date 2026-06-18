import type { StoredProfessional } from '@/domain/types/professional'

// Projeção event-sourced = o doc operacional `StoredProfessional` (sem PII —
// name/whatsapp/email lidos de `users/{userId}`, taxIdentity de
// `professionals_pii`, materializados na leitura) + a versão do stream.

export type ProfessionalState = StoredProfessional & { readonly _version: number }

export const INITIAL_PROFESSIONAL_STATE: ProfessionalState = {
  id: '',
  orgId: '',
  userId: '',
  operationalStatus: 'incomplete',
  defaultCommission: null,
  unitIds: [],
  serviceIds: [],
  createdAt: '',
  updatedAt: '',
  _version: 0,
}

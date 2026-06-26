import type { StoredOrg } from '@/domain/types/org'
import { DEFAULT_ORG_BRANDING } from '@/domain/types/org'

// Projeção event-sourced = o doc operacional `StoredOrg` (PII taxIdentity =
// CPF/CNPJ do dono omitida — vive num doc apagável, materializada na leitura;
// `name` é o nome do NEGÓCIO, não PII) + a versão do stream. O Org é uma pasta
// pura (PRD Identidade v2): sem fiscal, sem config de agenda/self-booking.
export type OrgState = StoredOrg & { readonly _version: number }

// Semente antes do primeiro evento — `org.created` sobrescreve tudo.
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

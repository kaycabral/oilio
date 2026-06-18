import type { StoredOrg } from '@/domain/types/org'
import {
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_ORG_BRANDING,
  DEFAULT_ORG_TIMEZONE,
  DEFAULT_SLOT_MINUTES,
} from '@/domain/types/org'
import { INFORMAL_FISCAL_PROFILE } from '@/domain/types/tax'
import { DEFAULT_WHATSAPP_TEMPLATES } from '@/domain/utils/whatsapp'

// Projeção event-sourced = o doc operacional `StoredOrg` (PII taxIdentity =
// CPF/CNPJ do dono omitida — vive num doc apagável, materializada na leitura;
// `name` é o nome do NEGÓCIO, não PII) + a versão do stream.
export type OrgState = StoredOrg & { readonly _version: number }

// Semente antes do primeiro evento — `org.created` sobrescreve tudo.
export const INITIAL_ORG_STATE: OrgState = {
  id: '',
  name: '',
  slug: '',
  vertical: 'barbershop',
  ownerUserId: '',
  selfBookingPublished: false,
  selfBookingPublishedAt: null,
  fiscalProfile: { ...INFORMAL_FISCAL_PROFILE },
  timezone: DEFAULT_ORG_TIMEZONE,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  branding: { ...DEFAULT_ORG_BRANDING },
  cancellationPolicy: { ...DEFAULT_CANCELLATION_POLICY },
  whatsappTemplates: { ...DEFAULT_WHATSAPP_TEMPLATES },
  createdAt: '',
  updatedAt: '',
  _version: 0,
}

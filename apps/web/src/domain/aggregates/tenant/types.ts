import type { StoredTenant } from '@/domain/types/tenant'
import {
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TENANT_BRANDING,
  DEFAULT_TENANT_TIMEZONE,
} from '@/domain/types/tenant'
import { DEFAULT_WHATSAPP_TEMPLATES } from '@/domain/utils/whatsapp'

// Projeção event-sourced = o doc operacional `StoredTenant` (PII taxIdentity =
// CPF/CNPJ do dono omitida — vive num doc apagável, materializada na leitura;
// `name` é o nome do NEGÓCIO, não PII) + a versão do stream.
export type TenantState = StoredTenant & { readonly _version: number }

// Semente antes do primeiro evento — `tenant.created` sobrescreve tudo.
export const INITIAL_TENANT_STATE: TenantState = {
  id: '',
  name: '',
  slug: '',
  vertical: 'barbershop',
  ownerUserId: '',
  selfBookingPublished: false,
  selfBookingPublishedAt: null,
  timezone: DEFAULT_TENANT_TIMEZONE,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  branding: { ...DEFAULT_TENANT_BRANDING },
  cancellationPolicy: { ...DEFAULT_CANCELLATION_POLICY },
  whatsappTemplates: { ...DEFAULT_WHATSAPP_TEMPLATES },
  createdAt: '',
  updatedAt: '',
  _version: 0,
}

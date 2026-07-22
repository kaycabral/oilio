import {
  type Address,
  type BusinessHours,
  type CancellationPolicy,
  type ConfirmationTemplates,
  type DayHours,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  type HoursRange,
  isValidCancellationNoticeMinutes,
  isValidSlotMinutes,
  isValidUnitSlug,
  normalizeBrazilMobile,
  resolveWhatsappTemplates,
  type SlotMinutes,
  UNIT_HOURS_MODES,
  type UnitAgendaConfig,
  type UnitHoursMode,
  validateHoursRange,
  type Weekday,
  WEEKDAYS,
} from '@/domain'
import { formString } from '@/shared/form-data'

export type AppointmentConfigInput = {
  slotMinutes: SlotMinutes
  cancellationPolicy: CancellationPolicy
  confirmationTemplates: ConfirmationTemplates
}

export function assembleAgenda(
  mode: UnitHoursMode,
  businessHours: BusinessHours,
  existing: UnitAgendaConfig | null,
  appointment: AppointmentConfigInput | null,
): UnitAgendaConfig {
  switch (mode) {
    case 'always_open':
      return { mode: 'always_open' }
    case 'fixed':
      return { mode: 'fixed', businessHours }
    case 'appointment': {
      const prior = existing?.mode === 'appointment' ? existing : null
      const slotMinutes = appointment?.slotMinutes ?? prior?.slotMinutes ?? DEFAULT_SLOT_MINUTES
      const cancellationPolicy = appointment?.cancellationPolicy ??
        prior?.cancellationPolicy ?? { ...DEFAULT_CANCELLATION_POLICY }
      const confirmationTemplates = resolveWhatsappTemplates(
        appointment?.confirmationTemplates ?? prior?.confirmationTemplates,
      )
      return {
        mode: 'appointment',
        businessHours,
        slotMinutes,
        cancellationPolicy,
        confirmationTemplates,
      }
    }
  }
}

export function parseAppointmentConfig(formData: FormData): AppointmentConfigInput {
  const slotRaw = Number.parseInt(formString(formData, 'slotMinutes'), 10)
  const slotMinutes: SlotMinutes = isValidSlotMinutes(slotRaw) ? slotRaw : DEFAULT_SLOT_MINUTES

  const cancellationEnabled = formData.get('cancellationEnabled') !== null
  const noticeRaw = Number.parseInt(formString(formData, 'cancellationMinNotice'), 10)
  const minNoticeMinutes = isValidCancellationNoticeMinutes(noticeRaw)
    ? noticeRaw
    : DEFAULT_CANCELLATION_POLICY.minNoticeMinutes
  const cancellationPolicy: CancellationPolicy = { enabled: cancellationEnabled, minNoticeMinutes }

  const confirmationTemplates = resolveWhatsappTemplates({
    confirmation: formString(formData, 'templateConfirmation'),
    reminder: formString(formData, 'templateReminder'),
    cancellation: formString(formData, 'templateCancellation'),
  })

  return { slotMinutes, cancellationPolicy, confirmationTemplates }
}

export type ParsedUnit = {
  name: string
  slug: string
  mobile: string
  email: string | null
  address: Address
  hoursMode: UnitHoursMode
  businessHours: BusinessHours
}

const WEEKDAY_LABEL_PT: Record<Weekday, string> = {
  monday: 'segunda',
  tuesday: 'terça',
  wednesday: 'quarta',
  thursday: 'quinta',
  friday: 'sexta',
  saturday: 'sábado',
  sunday: 'domingo',
}

export function parseAddress(formData: FormData): Address | string {
  const postalCode = formString(formData, 'postalCode').replace(/\D/g, '')
  if (postalCode.length !== 8) return 'CEP inválido (8 dígitos)'
  const state = formString(formData, 'state').trim()
  const city = formString(formData, 'city').trim()
  const neighborhood = formString(formData, 'neighborhood').trim()
  const street = formString(formData, 'street').trim()
  if (!state || !city || !neighborhood || !street) {
    return 'Endereço incompleto — preencha CEP, estado, cidade, bairro e logradouro'
  }
  const number = formString(formData, 'number').trim()
  if (number.length === 0) return 'Número é obrigatório'
  const complement = formString(formData, 'complement').trim() || null
  return { postalCode, state, city, neighborhood, street, number, complement }
}

export function parseBusinessHours(
  formData: FormData,
  mode: UnitHoursMode,
): BusinessHours | null | string {
  const out: Record<Weekday, DayHours> = {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  }
  if (mode === 'always_open') {
    for (const day of WEEKDAYS) out[day] = [{ open: '00:00', close: '23:59' }]
    return out
  }
  let anyEnabled = false
  for (const day of WEEKDAYS) {
    const enabled = formData.get(`bh_${day}_enabled`) !== null
    if (!enabled) {
      out[day] = null
      continue
    }
    anyEnabled = true
    const ranges: HoursRange[] = []
    for (let i = 0; formData.get(`bh_${day}_${i}_open`) !== null; i++) {
      const open = formString(formData, `bh_${day}_${i}_open`)
      const close = formString(formData, `bh_${day}_${i}_close`)
      const err = validateHoursRange({ open, close })
      if (err) return `${WEEKDAY_LABEL_PT[day]}: ${err.toLowerCase()}`
      ranges.push({ open, close })
    }
    if (ranges.length === 0) return `${WEEKDAY_LABEL_PT[day]}: informe ao menos um intervalo`
    out[day] = ranges
  }
  return anyEnabled ? out : null
}

function isUnitHoursMode(value: string): value is UnitHoursMode {
  return (UNIT_HOURS_MODES as readonly string[]).includes(value)
}

export function parseHoursMode(formData: FormData): UnitHoursMode | null {
  const raw = formString(formData, 'hoursMode')
  return isUnitHoursMode(raw) ? raw : null
}

export function parseUnitForm(formData: FormData): ParsedUnit | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  const slugRaw = formString(formData, 'slug').trim().toLowerCase()
  if (slugRaw.length > 0 && !isValidUnitSlug(slugRaw)) {
    return 'Slug inválido. Use letras minúsculas, números e hífens (3–64 caracteres). Alguns nomes são reservados.'
  }

  const mobileRaw = formString(formData, 'mobile').trim()
  if (mobileRaw.length === 0) return 'WhatsApp é obrigatório'
  const mobile = normalizeBrazilMobile(mobileRaw)
  if (!mobile) return 'Informe um celular com DDD e 9 dígitos (ex.: 11 91234-5678)'

  const email = formString(formData, 'email').trim() || null

  const address = parseAddress(formData)
  if (typeof address === 'string') return address
  const hoursMode = parseHoursMode(formData)
  if (hoursMode === null) return 'Escolha como a unidade atende'
  const businessHours = parseBusinessHours(formData, hoursMode)
  if (typeof businessHours === 'string') return businessHours
  if (businessHours === null) return 'Informe ao menos um dia de funcionamento'
  return { name, slug: slugRaw, mobile, email, address, businessHours, hoursMode }
}

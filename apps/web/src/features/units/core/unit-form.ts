// Functional core for the unit form: pure parsing + validation of submitted
// FormData into a typed payload (or a user-facing error string). No I/O — the
// adapter (units.actions) does the slug-uniqueness check + event emit + PII write.

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
  normalizeBrazilPhone,
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

// The appointment-only agenda configs the unit form now collects inline when
// `mode = appointment` (PRD Identidade v2 / C3): cancellation policy, message
// templates and slot granularity. Only present in the appointment variant — for
// fixed/always_open the form never renders these fields, so they're absent.
export type AppointmentConfigInput = {
  slotMinutes: SlotMinutes
  cancellationPolicy: CancellationPolicy
  confirmationTemplates: ConfirmationTemplates
}

// Assemble the `Unit.agenda` discriminated union from the parsed form mode +
// hours (PRD Identidade v2, context 3). The appointment-only configs
// (slotMinutes, cancellationPolicy, confirmationTemplates) are now collected
// INLINE by the unit form when `mode = appointment` (progressive disclosure) and
// passed here as `appointment`. The self-booking publish state is NOT a form
// field — it's preserved from the prior appointment agenda (or false on first
// entry). Pure (functional core); the adapter passes the prior agenda loaded
// from storage.
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
      // The form supplies the agenda configs inline; fall back to prior/defaults
      // only if a caller assembles without them (defensive).
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
        selfBookingPublished: prior?.selfBookingPublished ?? false,
        ...(prior?.selfBookingPublishedAt != null
          ? { selfBookingPublishedAt: prior.selfBookingPublishedAt }
          : {}),
      }
    }
  }
}

// Parse the appointment-only agenda configs from the form (PRD Identidade v2 /
// C3). Only meaningful when `mode = appointment` — the caller skips it for the
// other modes (the fields aren't rendered there). Invalid/absent values fall
// back to defaults so the agenda is always well-formed.
export function parseAppointmentConfig(formData: FormData): AppointmentConfigInput {
  const slotRaw = Number.parseInt(formString(formData, 'slotMinutes'), 10)
  const slotMinutes: SlotMinutes = isValidSlotMinutes(slotRaw) ? slotRaw : DEFAULT_SLOT_MINUTES

  const cancellationEnabled = formData.get('cancellationEnabled') !== null
  const noticeRaw = Number.parseInt(formString(formData, 'cancellationMinNotice'), 10)
  const minNoticeMinutes = isValidCancellationNoticeMinutes(noticeRaw)
    ? noticeRaw
    : DEFAULT_CANCELLATION_POLICY.minNoticeMinutes
  const cancellationPolicy: CancellationPolicy = { enabled: cancellationEnabled, minNoticeMinutes }

  // Empty templates fall back to the canonical defaults via resolveWhatsappTemplates.
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
  whatsapp: string
  email: string | null
  address: Address
  // REQUIRED (PRD Identidade v2 § Contrato de tipagem): the establishment's
  // timezone (moved Org→Unit). The unit form doesn't expose a tz picker yet —
  // it derives from the address state (BR UFs) at the action, defaulting to
  // `DEFAULT_UNIT_TIMEZONE`. `parseUnitForm` returns the raw inputs; the action
  // assembles `Unit.agenda` (the discriminated union) and timezone.
  hoursMode: UnitHoursMode
  // The base hours (per-day ranges). For `always_open` the action drops this
  // (that variant carries no businessHours). `parseUnitForm` rejects an empty
  // hours config rather than ever producing a unit without operating hours.
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

// Returns the BusinessHours object (or null if no day is enabled) — or an
// error string on first invalid range.
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
  let anyEnabled = false
  for (const day of WEEKDAYS) {
    const enabled = formData.get(`bh_${day}_enabled`) !== null
    if (!enabled) {
      out[day] = null
      continue
    }
    anyEnabled = true
    // SPIKE: 24h mode hides the time inputs — an enabled day is the whole day.
    if (mode === 'always_open') {
      out[day] = [{ open: '00:00', close: '23:59' }]
      continue
    }
    // SPIKE (multi-interval): collect the day's indexed ranges (split shifts).
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

// SPIKE (hours mode): read the mode marker; default to the legacy 'fixed'.
function isUnitHoursMode(value: string): value is UnitHoursMode {
  return (UNIT_HOURS_MODES as readonly string[]).includes(value)
}

export function parseHoursMode(formData: FormData): UnitHoursMode {
  const raw = formString(formData, 'hoursMode')
  return isUnitHoursMode(raw) ? raw : 'fixed'
}

export function parseUnitForm(formData: FormData): ParsedUnit | string {
  const name = formString(formData, 'name').trim()
  if (name.length < 2) return 'Nome é obrigatório'

  // Slug é opcional no form: blank => derivar do nome no momento da uniqueness
  // check. Valor explícito tem que passar pela validação de formato + reserved.
  const slugRaw = formString(formData, 'slug').trim().toLowerCase()
  if (slugRaw.length > 0 && !isValidUnitSlug(slugRaw)) {
    return 'Slug inválido. Use letras minúsculas, números e hífens (3–64 caracteres). Alguns nomes são reservados.'
  }

  const whatsappRaw = formString(formData, 'whatsapp').trim()
  if (whatsappRaw.length === 0) return 'WhatsApp é obrigatório'
  const whatsapp = normalizeBrazilPhone(whatsappRaw)
  if (!whatsapp) return 'WhatsApp inválido'

  const email = formString(formData, 'email').trim() || null

  const address = parseAddress(formData)
  if (typeof address === 'string') return address
  const hoursMode = parseHoursMode(formData)
  const businessHours = parseBusinessHours(formData, hoursMode)
  if (typeof businessHours === 'string') return businessHours
  // A unit is an operating establishment — it must declare hours (PRD
  // Identidade v2). An empty hours config is rejected at the boundary so
  // `businessHours` is never null on the constructed unit.
  if (businessHours === null) return 'Informe ao menos um dia de funcionamento'
  return { name, slug: slugRaw, whatsapp, email, address, businessHours, hoursMode }
}

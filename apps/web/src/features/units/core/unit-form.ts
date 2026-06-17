// Functional core for the unit form: pure parsing + validation of submitted
// FormData into a typed payload (or a user-facing error string). No I/O — the
// adapter (units.actions) does the slug-uniqueness check + event emit + PII write.

import {
  type Address,
  type BusinessHours,
  type DayHours,
  type HoursRange,
  UNIT_HOURS_MODES,
  type UnitHoursMode,
  WEEKDAYS,
  type Weekday,
  isValidUnitSlug,
  normalizeBrazilPhone,
  validateHoursRange,
} from '@/domain'
import { formString } from '@/shared/form-data'

export type ParsedUnit = {
  name: string
  slug: string
  whatsapp: string
  email: string | null
  address: Address
  businessHours: BusinessHours | null
  hoursMode: UnitHoursMode
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
  return { name, slug: slugRaw, whatsapp, email, address, businessHours, hoursMode }
}

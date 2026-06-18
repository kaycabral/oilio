import { type Page } from '@playwright/test'
import { checkStable } from './hydration'

// Helpers for shared `@cbrl/design` form fields whose affordance differs from a
// native input — driven the way a user does: by visible label/role, never by
// the hidden submission input.

// `DateField` (packages/design/src/components/date-field.tsx) renders a HIDDEN
// `<input name="birthDate">` carrying the ISO value PLUS a VISIBLE masked text
// input (placeholder `dd/mm/aaaa`, no `name`). Filling the hidden input is a
// no-op (not editable). Type the Brazilian-format value into the visible field
// — the component masks it and emits ISO under the hidden input.
//
// `value` is the Brazilian-format date `dd/mm/aaaa` (e.g. `10/05/1990`). The
// visible field is reached by its accessible name (the form's `<Label>` text),
// defaulting to "Data de nascimento".
export async function fillBirthDate(
  page: Page,
  value: string,
  label: string | RegExp = /data de nascimento/i,
): Promise<void> {
  await page.getByRole('textbox', { name: label }).fill(value)
}

// Converts an ISO `yyyy-mm-dd` date to the Brazilian `dd/mm/aaaa` form the
// masked DateField expects — for specs that derive a date dynamically.
export function isoToBrDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Enable at least one operating day in `BusinessHoursFields` so the `UnitForm`
// passes validation. v2 (PRD Identidade § Contrato de tipagem): a Unit MUST
// declare operating hours; `parseUnitForm` rejects an all-closed week, so the
// "Criar"/"Salvar" submit stays blocked until a day is on. The fresh
// `/units/new` form seeds every day OFF (no defaults), so create flows must
// toggle a weekday on (Monday by default). The guided first-unit form prefills
// hours, so this is only needed when driving the bare `/units/new` form.
export async function enableUnitBusinessHours(page: Page, day = 'monday'): Promise<void> {
  await checkStable(page.locator(`#bh_${day}`))
}

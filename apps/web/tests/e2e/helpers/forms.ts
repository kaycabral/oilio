import { expect, type Locator, type Page } from '@playwright/test'
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

// Fill the catalog item "Nome" field, which is a COMBOBOX (uncontrolled input
// wired to a debounced suggestion search), not a plain input. A bare `.fill()`
// can race the combobox's onChange so the submitted value comes back empty —
// leaving the form invalid, "Criar" disabled, and the redirect never firing
// (the create-flow flake). Type, ASSERT the value landed, then Escape to dismiss
// any suggestion list so it can't intercept the later submit click.
//
// Call this LAST among the required fields (after price/stock/unit): the
// combobox's debounced search resolves asynchronously and re-renders the form;
// filling siblings AFTER the name lets that late render clobber them. Fill the
// name last and the render has nothing of ours left to disturb.
export async function fillCatalogName(page: Page, value: string): Promise<void> {
  const name = page.locator('input[name="name"]')
  await name.click()
  await name.fill(value)
  await expect(name).toHaveValue(value)
  await name.press('Escape')
}

// Enable at least one operating day in `BusinessHoursFields` so the `UnitForm`
// passes validation. v2 (PRD Identidade § Contrato de tipagem): a Unit MUST
// declare operating hours; `parseUnitForm` rejects an all-closed week, so the
// "Criar"/"Salvar" submit stays blocked until a day is on. The fresh
// bare `UnitForm` seeds every day OFF (no defaults), so create flows must toggle
// a weekday on (Monday by default). The guided first-unit form / "+ Nova unidade"
// dialog prefill hours, so this is only needed when driving the bare form.
//
// Accepts a `Page` OR a `Locator` (e.g. the create dialog) so create flows can
// scope the toggle to the dialog and avoid strict-mode collisions with the
// listing behind it. `.locator()` exists on both.
export async function enableUnitBusinessHours(
  scope: Page | Locator,
  day = 'monday',
): Promise<void> {
  await checkStable(scope.locator(`#bh_${day}`))
}

import { expect, type Locator, type Page } from '@playwright/test'
import { checkStable } from './hydration'

export async function fillBirthDate(
  page: Page,
  value: string,
  label: string | RegExp = /data de nascimento/i,
): Promise<void> {
  await page.getByRole('textbox', { name: label }).fill(value)
}

export function isoToBrDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export async function fillCatalogName(page: Page, value: string): Promise<void> {
  const name = page.locator('input[name="name"]').filter({ visible: true })
  await name.click()
  await name.fill(value)
  await expect(name).toHaveValue(value)
  await name.press('Escape')
}

export async function enableUnitBusinessHours(
  scope: Page | Locator,
  day = 'Segunda',
): Promise<void> {
  await checkStable(scope.getByRole('switch', { name: day, exact: true }))
}

export type UnitWizardInput = {
  name: string
  whatsapp: string
  username?: string
  email?: string
  cep?: string
  number?: string
  mode?: 'appointment' | 'fixed' | 'always_open'
}

const WIZARD_MODE_LABEL = {
  appointment: /Por agendamento/,
  fixed: /Ordem de chegada/,
  always_open: /Sempre aberto/,
} as const

export async function fillUnitWizardUntilReview(
  scope: Page | Locator,
  input: UnitWizardInput,
): Promise<void> {
  await scope.getByRole('textbox', { name: /^Nome\*?$/ }).fill(input.name)
  if (input.username !== undefined) {
    const username = scope.getByRole('textbox', { name: 'Nome de usuário' })
    await username.click()
    await username.fill(input.username)
  }
  await scope.getByRole('textbox', { name: 'WhatsApp' }).fill(input.whatsapp)
  if (input.email !== undefined) {
    await scope.getByRole('textbox', { name: 'Email' }).fill(input.email)
  }
  await scope.getByRole('button', { name: 'Continuar' }).click()

  await scope.getByRole('textbox', { name: 'CEP' }).fill(input.cep ?? '01310-100')
  await expect(scope.getByText(/São Paulo\/SP/)).toBeVisible()
  await scope.getByRole('textbox', { name: 'Número' }).fill(input.number ?? '200')
  await scope.getByRole('button', { name: 'Continuar' }).click()

  await scope.getByRole('radio', { name: WIZARD_MODE_LABEL[input.mode ?? 'fixed'] }).click()
  if ((input.mode ?? 'fixed') !== 'always_open') {
    await enableUnitBusinessHours(scope)
  }
  await scope.getByRole('button', { name: 'Continuar' }).click()

  if (input.mode === 'appointment') {
    await scope.getByRole('button', { name: 'Continuar' }).click()
  }
}

export async function createUnitViaWizard(
  scope: Page | Locator,
  input: UnitWizardInput,
): Promise<void> {
  await fillUnitWizardUntilReview(scope, input)
  const confirmCta = scope.getByRole('button', { name: 'Confirmar e criar unidade' })
  const plainCta = scope.getByRole('button', { name: 'Criar unidade', exact: true })
  await expect(confirmCta.or(plainCta.and(scope.locator('button:enabled')))).toBeVisible()
  if (await confirmCta.isVisible()) {
    await checkStable(scope.getByRole('checkbox', { name: /Entendi e concordo/ }))
    await confirmCta.click()
    return
  }
  await plainCta.click()
}

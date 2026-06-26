import { type Locator, type Page } from '@playwright/test'

// Drive a design (Radix) Select the way a user does: open the combobox by its
// accessible name (which comes from the visible <Label> associated to the
// trigger) and click the option by its visible text. No data-testid, no
// aria-label, no touching the hidden native <select> — pure role + visible name,
// so the test exercises the same affordances a sighted/AT user perceives.
//
// `scope` is the Page, or a Locator (e.g. a dialog) that contains the trigger.
// The option list renders in a portal at the document root, so options are
// always queried from the Page.

function pageOf(scope: Page | Locator): Page {
  return 'page' in scope ? scope.page() : scope
}

export async function chooseOption(
  scope: Page | Locator,
  comboboxName: string | RegExp,
  optionName: string | RegExp,
): Promise<void> {
  await scope.getByRole('combobox', { name: comboboxName }).click()
  await pageOf(scope).getByRole('option', { name: optionName }).click()
}

// Same as chooseOption but picks by position — for cases where the visible label
// is dynamic/unknown and "the first real option" is what a user would pick.
export async function chooseOptionByIndex(
  scope: Page | Locator,
  comboboxName: string | RegExp,
  index: number,
): Promise<void> {
  await scope.getByRole('combobox', { name: comboboxName }).click()
  await pageOf(scope).getByRole('option').nth(index).click()
}

// Payment method is the most-used select across the suite. The visible option
// labels (what the user reads) — keep in sync with PAYMENT_LABEL in
// src/app/(app)/orders/_lib/order-detail-format.ts.
type PaymentMethod = 'cash' | 'credit_card' | 'debit_card' | 'pix'

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  pix: 'PIX',
}

export async function choosePaymentMethod(
  scope: Page | Locator,
  method: PaymentMethod,
): Promise<void> {
  await chooseOption(scope, 'Forma de pagamento', PAYMENT_METHOD_LABEL[method])
}

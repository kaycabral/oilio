import { type Locator, type Page } from '@playwright/test'

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

export async function chooseOptionByIndex(
  scope: Page | Locator,
  comboboxName: string | RegExp,
  index: number,
): Promise<void> {
  await scope.getByRole('combobox', { name: comboboxName }).click()
  await pageOf(scope).getByRole('option').nth(index).click()
}

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

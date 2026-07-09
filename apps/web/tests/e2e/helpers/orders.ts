import type { Page } from '@playwright/test'
import { chooseOption, chooseOptionByIndex } from './select'

export async function addCatalogItemToOrder(
  page: Page,
  itemName: string,
  opts: { attributionName?: string; attributionIndex?: number } = {},
): Promise<void> {
  await chooseOption(page, 'Item do catálogo', itemName)
  if (opts.attributionName != null) {
    await chooseOption(page, /Executor|Vendedor|Membro/, opts.attributionName)
  } else if (opts.attributionIndex != null) {
    await chooseOptionByIndex(page, /Executor|Vendedor|Membro/, opts.attributionIndex)
  }
  await page.getByRole('button', { name: 'Adicionar item' }).click()
}

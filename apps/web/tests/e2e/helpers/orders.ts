// Order detail helpers shared across E2E specs.
//
// The comanda now has a SINGLE "Adicionar item" control (brief 0023, AC-11 —
// #1005) that picks from the unified catalog: one combobox lists both kinds
// (service + product), and the added line infers its kind from the chosen
// item. The old two-button (Serviço | Produto) flow is gone. Centralising the
// add gesture here avoids each spec re-encoding the option-value lookup.

import type { Page } from '@playwright/test'
import { chooseOption, chooseOptionByIndex } from './select'

// Adds a catalog item to the open order by its visible name. The combobox lists
// options as "<name> · <serviço|produto> · R$ <price>", so we open it and click
// the option by its visible name (no reading option values).
//
// Brief 0030 (AC-04): the attribution control stores the member's `userId` and
// is labeled by kind — "Executor" (service) / "Vendedor" (product) / "Membro"
// (none picked). It carries a smart default (the opener's userId on a standalone
// sale), so by default we just submit. Pass `attributionName` to attribute to
// another member by display name, or `attributionIndex` to pick by position.
export async function addCatalogItemToOrder(
  page: Page,
  itemName: string,
  opts: { attributionName?: string; attributionIndex?: number } = {},
): Promise<void> {
  await chooseOption(page, 'Item do catálogo', itemName)
  // The attribution select's accessible name follows the picked item's kind.
  if (opts.attributionName != null) {
    await chooseOption(page, /Executor|Vendedor|Membro/, opts.attributionName)
  } else if (opts.attributionIndex != null) {
    await chooseOptionByIndex(page, /Executor|Vendedor|Membro/, opts.attributionIndex)
  }
  // Otherwise leave the smart default (server fills the opener's userId).
  await page.getByRole('button', { name: 'Adicionar item' }).click()
}

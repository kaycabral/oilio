import { expect, type Locator, type Page } from '@playwright/test'

// Helpers for the shared `@cbrl/design` List component (`packages/design/src/
// components/list.tsx`). The List renders a `<ul>` of `<li>` rows — each row is
// a `listitem` — with NO table semantics: there is no `row`/`cell`/`columnheader`
// role anywhere. Per-row Editar/Excluir live behind an overflow (⋯) menu
// (`RowActions`): a `button` whose accessible name starts with "Ações…" that
// opens `menuitem`s ("Editar", a link; "Excluir", which arms the shared confirm
// dialog). These helpers translate the old table-role assertions into the List's
// role/text affordances — no data-testid, web-first.

// The row that contains `text`. Replaces the old
// `getByRole('row', { name: text })` (rows are `listitem`s now). Use a string
// for substring matching or a RegExp for patterns (e.g. a timestamp).
export function listItem(page: Page, text: string | RegExp): Locator {
  return page.getByRole('listitem').filter({ hasText: text })
}

// The ⋯ overflow-menu trigger inside a given row. Its accessible name varies per
// surface ("Ações da unidade X", "Ações de Y", "Ações do plano Z"), so we match
// the shared "Ações" prefix — robust even when an exposed quick-action (e.g. the
// WhatsApp shortcut on the customers list) sits beside it.
export function rowActionsTrigger(row: Locator): Locator {
  return row.getByRole('button', { name: /^Ações\b/ })
}

// Opens a row's ⋯ menu and clicks the named action. "Editar" is a `menuitem`
// link; "Excluir" is a `menuitem` that arms the shared confirm dialog. Replaces
// the old inline `row.getByRole('link'|'button', { name: 'Editar'|'Excluir' })`.
export async function rowAction(
  page: Page,
  rowText: string | RegExp,
  action: string | RegExp,
): Promise<void> {
  const row = listItem(page, rowText)
  await expect(row).toBeVisible()
  await rowActionsTrigger(row).click()
  await page.getByRole('menuitem', { name: action }).click()
}

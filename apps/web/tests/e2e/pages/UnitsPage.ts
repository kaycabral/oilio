import type { Locator, Page } from '@playwright/test'

// Encapsulates the Unidades CRUD exercised by `units-*` specs. PRD Identidade v2
// folded the standalone `/units` list + `/units/new` form into the Negócios &
// Unidades surface (`/organizations`): listing is `/organizations`, creation is
// the inline "+ Nova unidade" dialog there, and only edit keeps a route
// (`/units/[id]`).
export class UnitsPage {
  constructor(private readonly page: Page) {}

  async gotoList(): Promise<void> {
    await this.page.goto('/organizations')
  }

  // Opens the inline "+ Nova unidade" dialog on the Negócios & Unidades surface
  // (replaces the old `/units/new` route, now a redirect to `/organizations`).
  async gotoNew(): Promise<void> {
    await this.page.goto('/organizations')
    await this.page.getByRole('button', { name: '+ Nova unidade' }).click()
    await this.page.getByRole('dialog').waitFor()
  }

  async gotoById(unitId: string): Promise<void> {
    await this.page.goto(`/units/${unitId}`)
  }

  nameField(): Locator {
    return this.page.getByRole('textbox', { name: /nome da unidade/i })
  }

  whatsappField(): Locator {
    return this.page.getByRole('textbox', { name: 'WhatsApp' })
  }

  saveButton(): Locator {
    return this.page.getByRole('button', { name: /salvar/i })
  }
}

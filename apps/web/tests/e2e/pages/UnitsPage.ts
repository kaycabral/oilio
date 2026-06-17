import type { Locator, Page } from '@playwright/test'

// Encapsulates the `/units` CRUD exercised by `units-*` specs.
export class UnitsPage {
  constructor(private readonly page: Page) {}

  async gotoList(): Promise<void> {
    await this.page.goto('/units')
  }

  async gotoNew(): Promise<void> {
    await this.page.goto('/units/new')
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

import type { Locator, Page } from '@playwright/test'

export class UnitsPage {
  constructor(private readonly page: Page) {}

  async gotoList(): Promise<void> {
    await this.page.goto('/organizations')
  }

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

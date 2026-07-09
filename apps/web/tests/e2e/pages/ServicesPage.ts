import type { Locator, Page } from '@playwright/test'

export class ServicesPage {
  constructor(private readonly page: Page) {}

  async gotoNew(): Promise<void> {
    await this.page.goto('/catalog/new?kind=service')
  }

  async gotoById(serviceId: string): Promise<void> {
    await this.page.goto(`/catalog/${serviceId}`)
  }

  nameField(): Locator {
    return this.page.getByRole('textbox', { name: /nome/i })
  }

  saveButton(): Locator {
    return this.page.getByRole('button', { name: /salvar/i })
  }
}

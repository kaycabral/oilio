import type { Locator, Page } from '@playwright/test'

// Encapsulates the service-item CRUD exercised by `services-per-unit`,
// `service-professional-link` and `appointment-snapshot` specs. Service items
// now live in the unified /catalog (brief 0023, #1005); the page object points
// straight at the catalog routes (no reliance on the /services redirect).
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

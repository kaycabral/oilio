import type { Locator, Page } from '@playwright/test'

export class MemberOperationsPage {
  constructor(private readonly page: Page) {}

  async gotoList(): Promise<void> {
    await this.page.goto('/team')
  }

  async gotoByUserId(userId: string): Promise<void> {
    await this.page.goto(`/team/${userId}`)
  }

  async gotoById(memberOperationId: string): Promise<void> {
    await this.gotoByUserId(`e2e-prof-user-${memberOperationId}`)
  }

  roleSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Papel' })
  }

  identityName(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  identityWhatsapp(): Locator {
    return this.page.getByRole('group', { name: 'WhatsApp', exact: true }).locator('dd')
  }

  identityEmail(): Locator {
    return this.page.getByRole('group', { name: 'Email', exact: true }).locator('dd')
  }

  operationalStatus(): Locator {
    return this.page.getByRole('group', { name: 'Status operacional', exact: true })
  }

  saveButton(): Locator {
    return this.page.getByRole('button', { name: /salvar/i })
  }
}

import type { Locator, Page } from '@playwright/test'

// Encapsulates the customer-facing `/me/appointments` surface used by
// `me-self-cancel.spec.ts` and `v0-1-golden-path.spec.ts`.
export class MeAppointmentsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/me/appointments')
  }

  appointmentByService(serviceName: string | RegExp): Locator {
    return this.page.getByText(serviceName)
  }

  cancelButton(): Locator {
    return this.page.getByRole('button', { name: /cancelar/i })
  }
}

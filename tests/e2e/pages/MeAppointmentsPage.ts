import type { Locator, Page } from '@playwright/test'

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

  rescheduleButton(): Locator {
    return this.page.getByRole('button', { name: /^reagendar$/i })
  }

  dateInput(): Locator {
    return this.page.getByLabel(/nova data/i)
  }

  timeSelect(): Locator {
    return this.page.getByRole('combobox', { name: /novo horário/i })
  }

  confirmRescheduleButton(): Locator {
    return this.page.getByRole('button', { name: /confirmar novo horário/i })
  }

  async pickTime(time: string): Promise<void> {
    await this.timeSelect().click()
    await this.page.getByRole('option', { name: time }).click()
  }
}

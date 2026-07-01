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

  // Toggles the inline reschedule panel open/closed (brief 0080, Grupo C).
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

  // Picks a grid time from the reschedule Select (Radix combobox).
  async pickTime(time: string): Promise<void> {
    await this.timeSelect().click()
    await this.page.getByRole('option', { name: time }).click()
  }
}

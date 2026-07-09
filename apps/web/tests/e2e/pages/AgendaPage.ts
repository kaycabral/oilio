import { expect, type Locator, type Page } from '@playwright/test'

export class AgendaPage {
  constructor(private readonly page: Page) {}

  async goto(date?: string): Promise<void> {
    const url = date ? `/agenda?date=${date}` : '/agenda'
    await this.page.goto(url)
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: 'Agenda', level: 1 })
  }

  offHoursBanner(): Locator {
    return this.page.getByText(/ainda não tem horários de funcionamento/i)
  }

  configureHoursLink(): Locator {
    return this.page.getByRole('link', { name: /configurar horários/i })
  }

  memberOperationColumn(name: string | RegExp): Locator {
    return this.page.getByRole('main').getByText(name)
  }

  incompleteProfileChip(): Locator {
    return this.page.getByText(/cadastro incompleto/i)
  }

  showCancelledToggle(): Locator {
    return this.page.getByRole('button', { name: /cancelados/i })
  }

  appointmentCard(customerName: string | RegExp): Locator {
    return this.page.getByRole('button', { name: customerName })
  }

  newAppointmentButton(): Locator {
    return this.page.getByRole('button', { name: '+ Novo' })
  }

  newAppointmentDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Novo agendamento' })
  }

  async openNewAppointmentDialog(): Promise<Locator> {
    const dialog = this.newAppointmentDialog()
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await this.newAppointmentButton().click()
      }
      await expect(dialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    return dialog
  }

  editAppointmentDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Editar agendamento' })
  }

  async openAppointmentDialog(customerName: string | RegExp): Promise<Locator> {
    const dialog = this.editAppointmentDialog()
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await this.appointmentCard(customerName).click()
      }
      await expect(dialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    return dialog
  }

  async startAttendance(customerName: string | RegExp): Promise<void> {
    const dialog = await this.openAppointmentDialog(customerName)
    await dialog.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(this.page).toHaveURL(/\/orders\/.+/)
  }
}

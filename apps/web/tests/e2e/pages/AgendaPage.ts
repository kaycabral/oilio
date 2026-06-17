import { expect, type Locator, type Page } from '@playwright/test'

// Encapsulates interactions with `/agenda` (authenticated owner/manager view).
// Methods cover the moves seen across agenda-* specs: navigation by date,
// opening the "+ Novo" dialog, asserting off-hours banner, locating a
// professional column.
//
// Locators are returned as `Locator` so the test can chain web-first
// assertions; actions return `Promise<void>` and wait implicitly via
// Playwright's auto-waiting.
export class AgendaPage {
  constructor(private readonly page: Page) {}

  // ── Navigation ──────────────────────────────────────────────────────────

  async goto(date?: string): Promise<void> {
    const url = date ? `/agenda?date=${date}` : '/agenda'
    await this.page.goto(url)
  }

  // ── Headings / banners ──────────────────────────────────────────────────

  heading(): Locator {
    return this.page.getByRole('heading', { name: 'Agenda', level: 1 })
  }

  offHoursBanner(): Locator {
    return this.page.getByText(/ainda não tem horários de funcionamento/i)
  }

  configureHoursLink(): Locator {
    return this.page.getByRole('link', { name: /configurar horários/i })
  }

  // ── Professional columns ────────────────────────────────────────────────

  professionalColumn(name: string | RegExp): Locator {
    return this.page.getByText(name)
  }

  // The non-operational professional chip — `IncompleteProfileBadge`, rendering
  // "Cadastro incompleto" after the approval→operational rename.
  incompleteProfileChip(): Locator {
    return this.page.getByText(/cadastro incompleto/i)
  }

  // ── New-appointment dialog ──────────────────────────────────────────────

  newAppointmentButton(): Locator {
    return this.page.getByRole('button', { name: '+ Novo' })
  }

  newAppointmentDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Novo agendamento' })
  }

  async openNewAppointmentDialog(): Promise<Locator> {
    const dialog = this.newAppointmentDialog()
    // "+ Novo" opens the dialog via a client onClick (setDialogOpen) — a click
    // that lands before the page hydrates is silently dropped, which surfaces as
    // flakiness under parallel load. Retry the open until the dialog actually
    // appears. This is hydration timing for a client-only control (the dialog
    // does open), not a masked mutation flake — mutations go through form
    // actions per PATTERNS.md, but opening a dialog has no form-action analogue.
    await expect(async () => {
      if (!(await dialog.isVisible())) {
        await this.newAppointmentButton().click()
      }
      await expect(dialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    return dialog
  }
}

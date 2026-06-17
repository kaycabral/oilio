import type { Locator, Page } from '@playwright/test'

// Encapsulates the professional operational surface. Since brief 0037 #1085
// the standalone `/professionals` route is gone: the listing lives in `/team`
// (members) and the operational edit lives in the member detail at
// `/team/{userId}`, behind an "Editar" affordance. The fixture derives each
// seeded pro's userId as `e2e-prof-user-{professionalId}`.
export class ProfessionalsPage {
  constructor(private readonly page: Page) {}

  // The team page is the people-management surface (no more `/professionals`).
  async gotoList(): Promise<void> {
    await this.page.goto('/team')
  }

  // Member detail for a professional, keyed by the membership userId.
  async gotoByUserId(userId: string): Promise<void> {
    await this.page.goto(`/team/${userId}`)
  }

  // Convenience: navigate to a seeded pro's member detail from its projection
  // id (the fixture's `tenant.professionalIds[i]`), deriving the userId.
  async gotoById(professionalId: string): Promise<void> {
    await this.gotoByUserId(`e2e-prof-user-${professionalId}`)
  }

  // Since the brief 0037 refino (review 2026-06-02) there is no "Editar" gate:
  // the editable member-detail form (role select + operational fields) is shown
  // directly with one Salvar. `roleSelect` is the inline role select (a design
  // combobox labelled "Papel"); its trigger shows the selected option's text.
  roleSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Papel' })
  }

  // Read-only identity values (#1046): name/whatsapp/email derive live from
  // `users/{userId}` and render as text (no inputs) at the top of the detail.
  identityName(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  identityWhatsapp(): Locator {
    return this.page.getByRole('group', { name: 'WhatsApp', exact: true }).locator('dd')
  }

  identityEmail(): Locator {
    return this.page.getByRole('group', { name: 'Email', exact: true }).locator('dd')
  }

  // Read-only derived operational status (#1047): never a writable input — the
  // value reflects the projected `operationalStatus`, flipped by domain event.
  operationalStatus(): Locator {
    return this.page.getByRole('group', { name: 'Status operacional', exact: true })
  }

  saveButton(): Locator {
    return this.page.getByRole('button', { name: /salvar/i })
  }
}

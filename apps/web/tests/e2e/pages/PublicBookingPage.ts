import type { Locator, Page } from '@playwright/test'
import { chooseOptionByIndex } from '../helpers/select'

// Encapsulates the public landing + self-book wizard exercised by
// `landing-public-*` and `self-book-*` specs.
//
// The flow has 4 surfaces:
//   1. `/[slug]`                            — tenant catalog (legacy aggregate)
//   2. `/[slug]/[unitSlug]`                 — per-unit catalog (Step 1 of #844)
//   3. `/[slug]/[unitSlug]/availability`    — slot picker (Step 2)
//   4. `/[slug]/[unitSlug]/book`            — confirmation form (Step 3)
//      → `/[slug]/[unitSlug]/book/success`  — confirmation page (Step 4)
//
// The legacy single-step `/[slug]/book` form is still routed for backwards
// compat — methods that target it are suffixed `Legacy`.
export class PublicBookingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  // ── Navigation ──────────────────────────────────────────────────────────

  async gotoCatalog(): Promise<void> {
    await this.page.goto(`/${this.slug}`)
  }

  async gotoUnit(unitSlug = 'unidade-1'): Promise<void> {
    await this.page.goto(`/${this.slug}/${unitSlug}`)
  }

  async gotoAvailability(
    unitSlug: string,
    params: { serviceId: string; from?: string },
  ): Promise<void> {
    const qs = new URLSearchParams({ service: params.serviceId })
    if (params.from) qs.set('from', params.from)
    await this.page.goto(`/${this.slug}/${unitSlug}/availability?${qs.toString()}`)
  }

  async gotoBookLegacy(): Promise<void> {
    await this.page.goto(`/${this.slug}/book`)
  }

  // ── Catalog assertions ──────────────────────────────────────────────────

  tenantHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  serviceCard(name: string | RegExp): Locator {
    return this.page.getByText(name)
  }

  // ── Availability ────────────────────────────────────────────────────────

  slotByProfessional(professionalName: string | RegExp): Locator {
    return this.page.getByRole('link', { name: professionalName })
  }

  // ── Confirmation form (wizard Step 3) ───────────────────────────────────

  confirmHeading(): Locator {
    return this.page.getByRole('heading', { name: /confirmar agendamento/i })
  }

  async fillContact(opts: { name: string; whatsapp: string }): Promise<void> {
    await this.page.getByRole('textbox', { name: /seu nome/i }).fill(opts.name)
    await this.page.getByRole('textbox', { name: /whatsapp/i }).fill(opts.whatsapp)
  }

  confirmButton(): Locator {
    return this.page.getByRole('button', { name: /confirmar agendamento/i })
  }

  successHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendamento confirmado/i })
  }

  // ── Legacy single-step form ─────────────────────────────────────────────

  legacyHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendar em/i })
  }

  async fillLegacyForm(opts: {
    serviceIndex?: number
    professionalIndex?: number
    dateTimeIso: string
    name: string
    whatsapp: string
  }): Promise<void> {
    await chooseOptionByIndex(this.page, /serviço/i, opts.serviceIndex ?? 0)
    await chooseOptionByIndex(this.page, /profissional/i, opts.professionalIndex ?? 0)
    await this.page.getByRole('textbox', { name: /data e horário/i }).fill(opts.dateTimeIso)
    await this.page.getByRole('textbox', { name: /seu nome/i }).fill(opts.name)
    await this.page.getByRole('textbox', { name: /whatsapp/i }).fill(opts.whatsapp)
  }

  legacySubmit(): Locator {
    return this.page.getByRole('button', { name: /solicitar agendamento/i })
  }

  legacySuccessHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendamento solicitado/i })
  }
}

// Convenience: most specs derive the slug from `seedTenant()` output —
// `e2e-${tenantId}` lowercase. Keep the formula in one place.
export function tenantSlug(tenantId: string): string {
  return `e2e-${tenantId}`.toLowerCase()
}

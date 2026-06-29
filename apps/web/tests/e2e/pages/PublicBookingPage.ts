import type { Locator, Page } from '@playwright/test'
import { chooseOptionByIndex } from '../helpers/select'

// Encapsulates the public landing + self-book wizard exercised by
// `landing-public-*` and `self-book-*` specs.
//
// The flow has 4 surfaces:
//   1. `/[slug]`                            — org catalog (legacy aggregate)
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

  orgHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  serviceCard(name: string | RegExp): Locator {
    return this.page.getByText(name)
  }

  // ── Availability ────────────────────────────────────────────────────────

  slotByMemberOperation(memberOperationName: string | RegExp): Locator {
    return this.page.getByRole('link', { name: memberOperationName })
  }

  // ── Confirmation form (wizard Step 3) ───────────────────────────────────

  confirmHeading(): Locator {
    return this.page.getByRole('heading', { name: /confirmar agendamento/i })
  }

  // Since brief 0077 (#1275) the confirm step carries NO PII inputs — login is
  // required and the Customer is derived from the uid. The CTA reads "Confirmar
  // agendamento" for a signed-in viewer and "Entrar e confirmar" otherwise.
  confirmButton(): Locator {
    return this.page.getByRole('button', { name: /confirmar agendamento|entrar e confirmar/i })
  }

  // The "Agendando como <nome>" line a signed-in + completed viewer sees (#1275).
  bookingAsNotice(): Locator {
    return this.page.getByText(/agendando como/i)
  }

  successHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendamento confirmado/i })
  }

  // ── Legacy single-step form ─────────────────────────────────────────────

  legacyHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendar em/i })
  }

  // Legacy form since #1275: NO customer PII inputs (login required, Customer
  // derived from the uid). Only service / pro / datetime are typed.
  async fillLegacyForm(opts: {
    serviceIndex?: number
    memberOperationIndex?: number
    dateTimeIso: string
  }): Promise<void> {
    await chooseOptionByIndex(this.page, /serviço/i, opts.serviceIndex ?? 0)
    await chooseOptionByIndex(this.page, /profissional/i, opts.memberOperationIndex ?? 0)
    await this.page.getByRole('textbox', { name: /data e horário/i }).fill(opts.dateTimeIso)
  }

  legacySubmit(): Locator {
    return this.page.getByRole('button', { name: /entrar e agendar/i })
  }

  legacySuccessHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendamento confirmado/i })
  }
}

// Convenience: most specs derive the slug from `seedOrg()` output —
// `e2e-${orgId}` lowercase. Keep the formula in one place.
export function orgSlug(orgId: string): string {
  return `e2e-${orgId}`.toLowerCase()
}

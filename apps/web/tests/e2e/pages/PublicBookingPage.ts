import type { Locator, Page } from '@playwright/test'

// Encapsulates the public landing + self-book wizard exercised by
// `landing-public-*` and `self-book-*` specs.
//
// The flow has 4 surfaces:
//   1. `/[slug]`                            — org catalog (single-unit shortcut)
//   2. `/[slug]/[unitSlug]`                 — per-unit catalog (Step 1 of #844)
//   3. `/[slug]/[unitSlug]/availability`    — single-page booking wizard (date +
//                                             professional filter + slot grid)
//   4. `/[slug]/[unitSlug]/book`            — confirmation form (Step 3)
//      → `/[slug]/[unitSlug]/book/success`  — confirmation page (Step 4)
//
// The legacy single-step org-level `/[slug]/book` form was removed (#1273): all
// booking goes through the per-unit wizard with real availability slots.
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

  // ── Catalog assertions ──────────────────────────────────────────────────

  orgHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  serviceCard(name: string | RegExp): Locator {
    return this.page.getByText(name)
  }

  // ── Availability (single-page wizard) ───────────────────────────────────

  // The slot grid renders one button per professional per time, each with an
  // accessible label "Agendar com <pro> às <hh:mm>". Match on that prefix so the
  // slot button is never confused with the professional FILTER chip above (which
  // carries the bare name). Now a button (the wizard navigates via router.push).
  slotByMemberOperation(memberOperationName: string | RegExp): Locator {
    const namePart =
      typeof memberOperationName === 'string' ? memberOperationName : memberOperationName.source
    return this.page.getByRole('button', { name: new RegExp(`agendar com ${namePart}`, 'i') })
  }

  // Sets the wizard's date picker (the grid re-queries on change). Specs that
  // need a deterministic day can either pass `from` to `gotoAvailability` (deep
  // link) or drive the picker directly here.
  async pickDate(isoDate: string): Promise<void> {
    await this.page.locator('#booking-date').fill(isoDate)
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
}

// Convenience: most specs derive the slug from `seedOrg()` output —
// `e2e-${orgId}` lowercase. Keep the formula in one place.
export function orgSlug(orgId: string): string {
  return `e2e-${orgId}`.toLowerCase()
}

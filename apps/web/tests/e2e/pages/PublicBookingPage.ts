import type { Locator, Page } from '@playwright/test'

// Encapsulates the public landing + self-book wizard exercised by
// `landing-public-*` and `self-book-*` specs.
//
// The flow has 4 surfaces:
//   1. `/[slug]`                            — org catalog (single-unit shortcut)
//   2. `/[slug]/[unitSlug]`                 — per-unit catalog (Step 1 of #844)
//   3. `/[slug]/[unitSlug]/availability`    — slot picker (Step 2)
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
}

// Convenience: most specs derive the slug from `seedOrg()` output —
// `e2e-${orgId}` lowercase. Keep the formula in one place.
export function orgSlug(orgId: string): string {
  return `e2e-${orgId}`.toLowerCase()
}

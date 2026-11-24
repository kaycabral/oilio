import type { Locator, Page } from '@playwright/test'

export class PublicBookingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

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

  orgHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 })
  }

  serviceCard(name: string | RegExp): Locator {
    return this.page.getByText(name)
  }

  slotByMemberOperation(memberOperationName: string | RegExp): Locator {
    const namePart =
      typeof memberOperationName === 'string' ? memberOperationName : memberOperationName.source
    return this.page.getByRole('button', { name: new RegExp(`agendar com ${namePart}`, 'i') })
  }

  async pickDate(isoDate: string): Promise<void> {
    await this.page.locator('#booking-date').fill(isoDate)
  }

  confirmHeading(): Locator {
    return this.page.getByRole('heading', { name: /confirmar agendamento/i })
  }

  confirmButton(): Locator {
    return this.page.getByRole('button', { name: /confirmar agendamento|entrar e confirmar/i })
  }

  bookingAsNotice(): Locator {
    return this.page.getByText(/agendando como/i)
  }

  successHeading(): Locator {
    return this.page.getByRole('heading', { name: /agendamento confirmado/i })
  }
}

export function orgSlug(orgId: string): string {
  return `e2e-${orgId}`.toLowerCase()
}

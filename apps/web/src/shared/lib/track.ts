import { logger } from './logger'

// Product-analytics emission (brief 0079 § "Eventos instrumentados"). Thin,
// typed seam over the structured `logger`: every call emits one `analytics`
// log line carrying the event name + properties, so the events are observable
// in runtime today (CDP/log scrape) and the call sites are already in place
// when a real OTel exporter lands — swapping the body here is the only change.
//
// SERVER-ONLY: `logger` reaches `request-context` (`node:async_hooks`), which
// cannot enter a browser bundle — so `track()` must be called from server code
// only. Client surfaces that need a product event route it through a server
// action / server page (e.g. the Configurações sections emit
// `settings_section_viewed` in their server page, brief 0090).
//
// Distinct from domain events (the event-sourced `order.*` / `subscription.*`
// stream, which is the source of truth): these are fire-and-forget product
// metrics, never read back to rebuild state.

// Each event's required property shape (brief 0079 § metrics). `org_id` /
// `user_id` lead every payload — they scope every metric query.
type AnalyticsEvents = {
  // Item added to a comanda was auto-marked `subscription` (covered + balance).
  order_item_coverage_autoset: {
    org_id: string
    user_id: string
    order_id: string
    item_ref_id: string
    subscription_id: string
  }
  // Operator flipped the suggested coverage (subscription↔sale).
  order_item_coverage_overridden: {
    org_id: string
    user_id: string
    order_id: string
    item_ref_id: string
    from: 'sale' | 'subscription'
    to: 'sale' | 'subscription'
  }
  // Wizard rendered a service carrying the "no seu plano" badge.
  self_book_covered_service_shown: {
    org_id: string
    user_id: string
    unit_id: string
    item_ref_id: string
  }
  // Backend rejected an appointment write whose `startAt` fell off the
  // configured grid / outside business hours (brief 0080 § metrics).
  appointment_write_rejected_offgrid: {
    org_id: string
    user_id: string
    unit_id: string
    surface: 'self_book' | 'reception'
    reason: 'off_grid'
  }
  // Customer rescheduled their own appointment from `/me/appointments`
  // (brief 0080 § metrics).
  appointment_rescheduled_self_service: {
    org_id: string
    user_id: string
    appointment_id: string
    from_start: string
    to_start: string
  }
  // A server action or loader refused access because the org's tier does not
  // unlock the billing capability (brief 0088 § "Eventos instrumentados"). The
  // gate NEVER depends on this event to exist — it's fire-and-forget metrics on
  // top of the real wall. `surface` names the denial point (action/loader) and
  // `verb` the attempted operation, so the upgrade-funnel query can attribute
  // denials to a surface.
  capability_denied: {
    org_id: string
    user_id: string
    capability: string
    surface: string
    verb: string
  }
  // A Configurações section was viewed (brief 0090 § "Eventos"). Emitted
  // server-side by each /settings/* page, so it fires for both the full page and
  // the modal (which renders the same page). The first view after opening the
  // modal is `section: 'profile'` (the default section), which doubles as the
  // "modal opened" signal. Client-side `track()` isn't possible (the seam reaches
  // the server logger / node:async_hooks), hence the server-page emission.
  settings_section_viewed: {
    org_id: string
    user_id: string
    section: string
  }
  // Owner confirmed the native cancellation (cancel_at_period_end set on the
  // Stripe subscription). The paid access runs until the period end. Emitted by
  // the `cancelSubscription` server action (brief 0090, AC-09).
  billing_cancel_confirmed: {
    org_id: string
    user_id: string
  }
}

export type AnalyticsEventName = keyof AnalyticsEvents

export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsEvents[E]): void {
  logger.info('analytics', { event, ...props })
}

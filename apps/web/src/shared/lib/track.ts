import { logger } from './logger'

// Product-analytics emission (brief 0079 § "Eventos instrumentados"). Thin,
// typed seam over the structured `logger`: every call emits one `analytics`
// log line carrying the event name + properties, so the events are observable
// in runtime today (CDP/log scrape) and the call sites are already in place
// when a real OTel exporter lands — swapping the body here is the only change.
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
}

export type AnalyticsEventName = keyof AnalyticsEvents

export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsEvents[E]): void {
  logger.info('analytics', { event, ...props })
}

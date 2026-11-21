import { logger } from '@cbrl/log'

type AnalyticsEvents = {
  order_item_coverage_autoset: {
    org_id: string
    user_id: string
    order_id: string
    item_ref_id: string
    subscription_id: string
  }
  order_item_coverage_overridden: {
    org_id: string
    user_id: string
    order_id: string
    item_ref_id: string
    from: 'sale' | 'subscription'
    to: 'sale' | 'subscription'
  }
  self_book_covered_service_shown: {
    org_id: string
    user_id: string
    unit_id: string
    item_ref_id: string
  }
  appointment_write_rejected_offgrid: {
    org_id: string
    user_id: string
    unit_id: string
    surface: 'self_book' | 'reception'
    reason: 'off_grid'
  }
  appointment_rescheduled_self_service: {
    org_id: string
    user_id: string
    appointment_id: string
    from_start: string
    to_start: string
  }
  capability_denied: {
    org_id: string
    user_id: string
    capability: string
    surface: string
    verb: string
  }
  settings_section_viewed: {
    org_id: string
    user_id: string
    section: string
  }
  billing_cancel_confirmed: {
    org_id: string
    user_id: string
  }
  unit_wizard_opened: {
    org_id: string
    user_id: string
  }
  unit_wizard_step_completed: {
    org_id: string
    user_id: string
    step: string
    mode: string | null
  }
  unit_wizard_abandoned: {
    org_id: string
    user_id: string
    last_step: string
  }
  unit_wizard_cost_acknowledged: {
    org_id: string
    user_id: string
  }
}

export type AnalyticsEventName = keyof AnalyticsEvents

export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsEvents[E]): void {
  logger.info('analytics', { event, ...props })
}

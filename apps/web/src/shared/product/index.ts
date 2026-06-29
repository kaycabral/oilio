export { channelOf, emitClientFunnelEvent } from './client-funnel-events'
export type {
  AppointmentCreatedPayload,
  ClientFunnelEventName,
  ClientInviteIssuedPayload,
  ClientProfileCompletedPayload,
  ClientSignedInPayload,
} from './client-funnel-events'
export { emitProductEvent } from './product-events'
export type {
  ProductAutocontributedPayload,
  ProductContributionDeferredPayload,
  ProductEventName,
  ProductLookupPayload,
  ProductSearchPayload,
} from './product-events'
export { resolveGate, runProductGate } from './product-gate'
export type { ProductGateFields, ProductGateResult } from './product-gate'

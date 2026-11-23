import { Schema } from 'effect'

import { CommissionRule } from './member-operation'

export const ServiceUnitOverride = Schema.mutable(
  Schema.Struct({
    priceCents: Schema.optional(Schema.Number),
    durationMinutes: Schema.optional(Schema.Number),
    commission: Schema.optional(Schema.NullOr(CommissionRule)),
  }),
)
export type ServiceUnitOverride = typeof ServiceUnitOverride.Type

export const SERVICE_PRICE_VISIBILITIES = ['visible', 'on_request'] as const
export const ServicePriceVisibility = Schema.Literal(...SERVICE_PRICE_VISIBILITIES)
export type ServicePriceVisibility = typeof ServicePriceVisibility.Type

export function normalizeServicePublicVisible(value: unknown): boolean {
  return value === true
}

export function normalizeServicePriceVisibility(value: unknown): ServicePriceVisibility {
  return value === 'on_request' ? 'on_request' : 'visible'
}

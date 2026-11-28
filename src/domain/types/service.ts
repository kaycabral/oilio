import { Schema, Struct } from 'effect'

import { CommissionRule } from './member-operation'

export const ServiceUnitOverride = Schema.Struct({
  priceCents: Schema.optional(Schema.Number),
  durationMinutes: Schema.optional(Schema.Number),
  commission: Schema.optional(Schema.NullOr(CommissionRule)),
}).mapFields(Struct.map(Schema.mutableKey))
export type ServiceUnitOverride = typeof ServiceUnitOverride.Type

export const SERVICE_PRICE_VISIBILITIES = ['visible', 'on_request'] as const
export const ServicePriceVisibility = Schema.Literals(SERVICE_PRICE_VISIBILITIES)
export type ServicePriceVisibility = typeof ServicePriceVisibility.Type

export function normalizeServicePublicVisible(value: unknown): boolean {
  return value === true
}

export function normalizeServicePriceVisibility(value: unknown): ServicePriceVisibility {
  return value === 'on_request' ? 'on_request' : 'visible'
}

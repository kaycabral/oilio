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

// Whether the effective price is shown in the public catalog (#841). When
// 'on_request', the catalog renders "Sob consulta" instead of a value —
// useful for services whose price is negotiated case-by-case (eg. tinturas
// complexas, hidratações premium) but still bookable via the public flow.
export const SERVICE_PRICE_VISIBILITIES = ['visible', 'on_request'] as const
export const ServicePriceVisibility = Schema.Literal(...SERVICE_PRICE_VISIBILITIES)
export type ServicePriceVisibility = typeof ServicePriceVisibility.Type

export function normalizeServicePublicVisible(value: unknown): boolean {
  return value === true
}

export function normalizeServicePriceVisibility(value: unknown): ServicePriceVisibility {
  return value === 'on_request' ? 'on_request' : 'visible'
}

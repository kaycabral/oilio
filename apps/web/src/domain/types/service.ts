import { Schema } from 'effect'

import { CommissionRule } from './professional'

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

export const Service = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    name: Schema.String,
    category: Schema.NullOr(Schema.String),
    // Base pricing/duration/commission — used unless overridden per unit.
    durationMinutes: Schema.Number,
    priceCents: Schema.Number,
    commission: Schema.NullOr(CommissionRule),
    requiredResources: Schema.mutable(Schema.Array(Schema.String)),
    active: Schema.Boolean,
    // Aparece no catálogo público (/[slug]) e é elegível pra agendamento via
    // landing pública. Default false — owner habilita explicitamente o que
    // quer expor pro cliente final (preço, duração, nome).
    publicVisible: Schema.Boolean,
    // Public-catalog price rendering. Default 'visible'. See #841.
    priceVisibility: ServicePriceVisibility,
    // Where the service is offered. Non-empty. A service oferecido em uma
    // unit pode opcionalmente ter override de preço/duração/comissão na
    // mesma — keys de `unitOverrides` ⊆ `unitIds`. Identidade do serviço
    // ("Corte") é única no tenant (mesmo nome/categoria em todas as units);
    // só os atributos comerciais variam (#874).
    unitIds: Schema.mutable(Schema.Array(Schema.String)),
    unitOverrides: Schema.NullOr(
      Schema.mutable(Schema.Record({ key: Schema.String, value: ServiceUnitOverride })),
    ),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Service = typeof Service.Type

export function normalizeServicePublicVisible(value: unknown): boolean {
  return value === true
}

export function normalizeServicePriceVisibility(value: unknown): ServicePriceVisibility {
  return value === 'on_request' ? 'on_request' : 'visible'
}

// Sanitized projection of `Service` for the public catalog (#841). Drops
// `commission`, `unitOverrides`, `active`, `publicVisible`, `tenantId` and
// other internal fields. `priceCents` is `null` when `priceVisibility ===
// 'on_request'` so callers can render "Sob consulta" without re-reading the
// flag. `priceCents`/`durationMinutes` are resolved per-unit via
// `resolveServiceForUnit`.
export const PublicService = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    category: Schema.NullOr(Schema.String),
    requiredResources: Schema.mutable(Schema.Array(Schema.String)),
    priceCents: Schema.NullOr(Schema.Number),
    durationMinutes: Schema.Number,
  }),
)
export type PublicService = typeof PublicService.Type

export function toPublicService(service: Service, unitId: string): PublicService {
  const resolved = resolveServiceForUnit(service, unitId)
  const priceVisibility = normalizeServicePriceVisibility(service.priceVisibility)
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    requiredResources: service.requiredResources,
    priceCents: priceVisibility === 'on_request' ? null : resolved.priceCents,
    durationMinutes: resolved.durationMinutes,
  }
}

// Returns the effective (post-override) commercial attributes for a service
// at a given unit. When `unitId` has no override (or isn't in `unitIds`),
// falls back to the service-level defaults. Pure — safe to call anywhere
// (catalog rendering, booking confirmation, order finalization, agenda
// duration math).
export function resolveServiceForUnit(
  service: Service,
  unitId: string,
): {
  priceCents: number
  durationMinutes: number
  commission: CommissionRule | null
} {
  const o = service.unitOverrides?.[unitId] ?? {}
  return {
    priceCents: o.priceCents ?? service.priceCents,
    durationMinutes: o.durationMinutes ?? service.durationMinutes,
    commission: o.commission !== undefined ? o.commission : service.commission,
  }
}

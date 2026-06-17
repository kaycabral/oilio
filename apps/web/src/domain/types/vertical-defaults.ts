import { Schema } from 'effect'

import type { Vertical } from './enums'
import { SlotMinutes } from './tenant'

export const SuggestedService = Schema.mutable(
  Schema.Struct({
    name: Schema.String,
    category: Schema.String,
    durationMinutes: Schema.Number,
    priceCents: Schema.Number,
  }),
)
export type SuggestedService = typeof SuggestedService.Type

export const VerticalDefaults = Schema.mutable(
  Schema.Struct({
    suggestedServices: Schema.mutable(Schema.Array(SuggestedService)),
    defaultSlotMinutes: SlotMinutes,
  }),
)
export type VerticalDefaults = typeof VerticalDefaults.Type

export const VERTICAL_DEFAULTS: Record<Vertical, VerticalDefaults> = {
  barbershop: {
    suggestedServices: [
      { name: 'Corte masculino', category: 'Corte', durationMinutes: 30, priceCents: 4000 },
      { name: 'Barba', category: 'Barba', durationMinutes: 20, priceCents: 3000 },
      { name: 'Corte + Barba', category: 'Combo', durationMinutes: 45, priceCents: 6500 },
      { name: 'Sobrancelha', category: 'Estética', durationMinutes: 10, priceCents: 1500 },
    ],
    defaultSlotMinutes: 15,
  },
  auto_wash: {
    suggestedServices: [
      { name: 'Lavagem simples', category: 'Externa', durationMinutes: 30, priceCents: 3000 },
      { name: 'Lavagem completa', category: 'Completa', durationMinutes: 60, priceCents: 6000 },
      { name: 'Higienização interna', category: 'Interna', durationMinutes: 90, priceCents: 10000 },
    ],
    defaultSlotMinutes: 30,
  },
  auto_detailing: {
    suggestedServices: [
      { name: 'Polimento técnico', category: 'Polimento', durationMinutes: 180, priceCents: 30000 },
      { name: 'Vitrificação', category: 'Proteção', durationMinutes: 240, priceCents: 50000 },
      { name: 'Cristalização', category: 'Proteção', durationMinutes: 120, priceCents: 20000 },
    ],
    defaultSlotMinutes: 30,
  },
  other: {
    suggestedServices: [],
    defaultSlotMinutes: 15,
  },
}

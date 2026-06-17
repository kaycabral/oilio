import { Schema } from 'effect'

import { CommissionRule } from './professional'
import { CancellationPolicy } from './tenant'

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
export const AppointmentStatus = Schema.Literal(...APPOINTMENT_STATUSES)
export type AppointmentStatus = typeof AppointmentStatus.Type

// Who triggered a cancel or reschedule transition. Self-cancel from the
// customer-facing flow (#845) sets 'customer'; staff actions from the agenda
// or order set 'staff'; 'system' is a non-human transition — e.g. the LGPD
// erasure cascade cancelling a customer's future appointments (brief 0032,
// AC-12). Tracking is always populated even when the tenant's cancellation
// policy is disabled — the policy only gates customer communication. Wiki:
// 04-Roadmap-Politica-Cancelamento.
export const AppointmentActorRole = Schema.Literal('customer', 'staff', 'system')
export type AppointmentActorRole = typeof AppointmentActorRole.Type

export const Appointment = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    unitId: Schema.String,
    professionalId: Schema.String,
    customerId: Schema.String,
    // FK into a `catalog_items` doc of kind service (brief 0023, #1004 — was the
    // legacy `services` collection). Field name kept as `serviceId` (semantics
    // "books a service") to minimize the consumer-migration blast radius.
    serviceId: Schema.String,
    startAt: Schema.String,
    endAt: Schema.String,
    status: AppointmentStatus,
    // Snapshots gravados no commit do appointment via `resolveServiceForUnit`
    // — preço/duração/comissão efetivos NO MOMENTO do booking, imutáveis
    // depois. Owner mexer em `Service.unitOverrides` não afeta histórico
    // (financeiro, comissão e cancellation policy lêem daqui, não do Service
    // vivo). Ver #875.
    servicePriceCentsSnapshot: Schema.Number,
    serviceDurationMinutesSnapshot: Schema.Number,
    commissionSnapshot: Schema.NullOr(CommissionRule),
    // Snapshot da `Tenant.cancellationPolicy` NO MOMENTO do booking (#1038,
    // ES-seletivo frente C). O direito do cliente de auto-cancelar é avaliado
    // contra esta cópia imutável, não contra a policy viva — mudar a policy do
    // tenant não retroage sobre agendamentos já criados. `null` em
    // agendamentos legados/pré-migração: os call-sites de cancel caem na policy
    // viva do tenant como fallback. Ver brief 0027.
    cancellationPolicySnapshot: Schema.NullOr(CancellationPolicy),
    // Duplicated from the related `Customer.userId` / `Professional.userId`
    // so that Firestore CollectionGroup queries — `collectionGroup('appointments')
    // .where('customerUserId', '==', myUid)` — can return the signed-in user's
    // history across every tenant they appear in. CG queries only filter on
    // fields stored *directly* on the doc, not via FK joins, so we copy the
    // canonical userId here. Decided in #832 — wiki:
    // 02-Estrategia-Modelo-Identidade § Visibilidade de histórico.
    customerUserId: Schema.String,
    // Null when the Professional doc was created without an authenticated user
    // attached (rec-created placeholder before the pro accepts an invite).
    professionalUserId: Schema.NullOr(Schema.String),
    // Transition tracking — populated on every cancel/reschedule/no-show
    // regardless of the tenant's cancellation policy toggle. Lets the product
    // decide later whether to gate UX on `noticeMinutes` once data exists.
    cancelledAt: Schema.optional(Schema.String),
    cancelledBy: Schema.optional(AppointmentActorRole),
    cancelledNoticeMinutes: Schema.optional(Schema.Number),
    rescheduledAt: Schema.optional(Schema.String),
    rescheduledBy: Schema.optional(AppointmentActorRole),
    rescheduledNoticeMinutes: Schema.optional(Schema.Number),
    noShowMarkedAt: Schema.optional(Schema.String),
    noShowMarkedBy: Schema.optional(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Appointment = typeof Appointment.Type

// scheduledStartAt - actionAt, in whole minutes. Negative means the action
// happened after the appointment was supposed to start.
export function computeNoticeMinutes(scheduledStartAt: string, actionAt: string): number {
  const start = new Date(scheduledStartAt).getTime()
  const at = new Date(actionAt).getTime()
  return Math.floor((start - at) / 60_000)
}

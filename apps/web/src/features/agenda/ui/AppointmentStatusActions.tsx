'use client'

import { type Appointment } from '@/domain'
import {
  type AppointmentFormActionState,
  cancelAppointmentFormAction,
  markAppointmentNoShowFormAction,
  unmarkAppointmentNoShowFormAction,
} from '@/features/agenda/adapters/agenda.actions'
import { startAttendanceFormAction } from '@/features/orders/adapters/orders.actions'
import { Button } from '@cbrl/design'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'

const INITIAL_FORM_STATE: AppointmentFormActionState = { ok: false }

export function AppointmentStatusActions({
  appointment,
  whatsappLink,
  canMarkNoShow,
  onClose,
}: {
  appointment: Appointment
  whatsappLink: string | null
  canMarkNoShow: boolean
  onClose: () => void
}) {
  return (
    <>
      {appointment.status === 'scheduled' && whatsappLink ? (
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="border-input bg-background hover:bg-accent inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition"
        >
          📱 Enviar confirmação por WhatsApp
        </a>
      ) : null}

      {appointment.status === 'scheduled' ? (
        <StartAttendanceForm appointmentId={appointment.id} />
      ) : null}

      {canMarkNoShow ? <NoShowMarkForm appointmentId={appointment.id} onSuccess={onClose} /> : null}

      {appointment.status === 'no_show' ? (
        <NoShowUnmarkForm appointmentId={appointment.id} onSuccess={onClose} />
      ) : null}
    </>
  )
}

function StartAttendanceForm({ appointmentId }: { appointmentId: string }) {
  return (
    <form action={startAttendanceFormAction} className="flex flex-col gap-1">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <StartAttendanceSubmit />
    </form>
  )
}

function StartAttendanceSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="default" disabled={pending} className="w-full">
      ▶ Iniciar atendimento
    </Button>
  )
}

function NoShowMarkForm({
  appointmentId,
  onSuccess,
}: {
  appointmentId: string
  onSuccess: () => void
}) {
  const [state, formAction, pending] = useActionState(
    markAppointmentNoShowFormAction,
    INITIAL_FORM_STATE,
  )
  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state.ok, onSuccess])
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        Marcar não compareceu
      </Button>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
    </form>
  )
}

function NoShowUnmarkForm({
  appointmentId,
  onSuccess,
}: {
  appointmentId: string
  onSuccess: () => void
}) {
  const [state, formAction, pending] = useActionState(
    unmarkAppointmentNoShowFormAction,
    INITIAL_FORM_STATE,
  )
  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state.ok, onSuccess])
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        Desmarcar não compareceu
      </Button>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
    </form>
  )
}

export function CancelConfirmForm({
  appointmentId,
  onCancel,
  onSuccess,
}: {
  appointmentId: string
  onCancel: () => void
  onSuccess: () => void
}) {
  const [state, formAction, pending] = useActionState(
    cancelAppointmentFormAction,
    INITIAL_FORM_STATE,
  )
  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state.ok, onSuccess])
  return (
    <form action={formAction} className="mr-auto flex items-center gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <span className="text-muted-foreground text-xs">Cancelar mesmo?</span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Sim
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        Não
      </Button>
      {state.error ? <p className="text-destructive text-xs">{state.error}</p> : null}
    </form>
  )
}

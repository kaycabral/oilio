'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { buildWhatsappLink, type CancellationPolicy } from '@/domain'
import { createWizardBooking } from '@/features/self-book/adapters/wizard-book.actions'
import { formatNoticeWindow } from '@/features/self-book/core/format'
import { toRoute } from '@/shared/routes'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@cbrl/design'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'

// Step 3 of the self-book wizard (#844). All booking data (service, pro,
// startAt) is locked from the URL — the only inputs are the visitor's
// contact details. On success, navigates to /[slug]/[unitSlug]/book/success.
export function ConfirmBookingForm({
  slug,
  unitSlug,
  serviceId,
  professionalId,
  startAtIso,
  serviceLabel,
  professionalLabel,
  startAtLabel,
  cancellationPolicy,
  changeSlotHref,
  prefill,
  unitWhatsapp,
  unitName,
}: {
  slug: string
  unitSlug: string
  serviceId: string
  professionalId: string
  startAtIso: string
  serviceLabel: string
  professionalLabel: string
  startAtLabel: string
  cancellationPolicy: CancellationPolicy
  changeSlotHref: string
  // #864 session pre-fill. When the visitor has a global User with
  // `completionCompleted=true`, the page resolves their PII server-side
  // and threads it here so the inputs start filled — single-click confirm.
  // `null` means anonymous flow.
  prefill: { name: string; whatsapp: string; email: string | null } | null
  // Brief 0019 Group D — AC-17. Unit WhatsApp (normalized E.164 digits)
  // used to build the "Falar no WhatsApp" CTA shown when the booking
  // attempt is rejected because it's outside the customer's plan scope.
  // Unit name is interpolated into the pre-filled message so the
  // operator on the other end sees which shop the request belongs to.
  unitWhatsapp: string
  unitName: string
}) {
  const router = useRouter()
  const customerNameId = useId()
  const customerWhatsappId = useId()
  const customerEmailId = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Brief 0019 Group D — AC-17. Tracked separately from `error` so the
  // UI can swap the generic error pill for a friendly message + WA CTA
  // without losing the rest of the form state.
  const [outOfScope, setOutOfScope] = useState<string | null>(null)
  // Brief 0019 Group C — AC-12. When the server detects the customer
  // already booked the maximum same-day appointments, it returns a
  // reschedule signal instead of an error. The modal points the visitor
  // to /me/appointments (reuses brief 0003 #651 flow) — we don't invent
  // a parallel reschedule path.
  const [rescheduleSignal, setRescheduleSignal] = useState<{
    href: string
    existingStartAt: string
  } | null>(null)

  // Brief 0019 Group D — AC-17. Pre-canned WhatsApp link to the unit's
  // operator. `null` when the unit has no normalizable WhatsApp number
  // (the form then falls back to a plain message — no broken link).
  const whatsappHref = buildWhatsappLink(
    unitWhatsapp,
    `Oi! Sou cliente assinante e gostaria de agendar em ${unitName} fora do meu plano. Pode me ajudar?`,
  )

  function onSubmit(formData: FormData) {
    setError(null)
    setOutOfScope(null)
    setRescheduleSignal(null)
    formData.set('slug', slug)
    formData.set('unitSlug', unitSlug)
    formData.set('serviceId', serviceId)
    formData.set('professionalId', professionalId)
    formData.set('startAt', startAtIso)
    startTransition(async () => {
      const res = await createWizardBooking(formData)
      if (res.ok) {
        router.push(`/${slug}/${unitSlug}/book/success?appt=${res.bookingId}`)
        return
      }
      if ('kind' in res && res.kind === 'reschedule-required') {
        setRescheduleSignal({
          href: res.rescheduleHref,
          existingStartAt: res.existingAppointment.startAt,
        })
        return
      }
      if ('kind' in res && res.kind === 'out-of-scope') {
        setOutOfScope(res.error)
        return
      }
      setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <dl className="bg-muted/30 grid grid-cols-[max-content,1fr] gap-x-4 gap-y-1 rounded-md p-3 text-sm">
        <dt className="text-muted-foreground">Serviço</dt>
        <dd>{serviceLabel}</dd>
        <dt className="text-muted-foreground">Profissional</dt>
        <dd>{professionalLabel}</dd>
        <dt className="text-muted-foreground">Quando</dt>
        <dd>{startAtLabel}</dd>
      </dl>

      <Link
        href={toRoute(changeSlotHref)}
        className="text-primary -mt-2 self-start text-xs underline-offset-2 hover:underline"
      >
        ← Trocar horário
      </Link>

      {prefill ? (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
          Logado como <strong>{prefill.name || 'cliente'}</strong>. Confirme os dados abaixo ou
          edite se algo mudou.
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor={customerNameId} className="text-sm font-medium">
          Seu nome
        </Label>
        <Input
          id={customerNameId}
          name="customerName"
          required
          minLength={2}
          placeholder="Nome completo"
          defaultValue={prefill?.name ?? ''}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={customerWhatsappId} className="text-sm font-medium">
          WhatsApp
        </Label>
        <PhoneInput
          id={customerWhatsappId}
          name="customerWhatsapp"
          required
          defaultValue={prefill?.whatsapp ?? ''}
        />
        <span className="text-muted-foreground text-xs">
          Usado pra confirmar e lembrar do horário.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={customerEmailId} className="text-sm font-medium">
          E-mail (opcional)
        </Label>
        <Input
          id={customerEmailId}
          name="customerEmail"
          type="email"
          placeholder="seu@email.com"
          autoComplete="email"
          defaultValue={prefill?.email ?? ''}
        />
      </div>

      {outOfScope ? (
        <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p className="text-foreground/90">{outOfScope}</p>
          {whatsappHref ? (
            <Button asChild variant="outline" size="sm" className="self-start">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Falar no WhatsApp
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border p-2 text-sm">
          {error}
        </p>
      ) : null}

      {cancellationPolicy.enabled ? (
        <p className="text-muted-foreground text-xs">
          Cancelamentos pedem pelo menos {formatNoticeWindow(cancellationPolicy.minNoticeMinutes)}{' '}
          de antecedência. Após esse prazo, pode contar como falta.
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Confirmando…' : 'Confirmar agendamento'}
      </Button>

      <Dialog
        open={rescheduleSignal != null}
        onOpenChange={(open) => {
          if (!open) setRescheduleSignal(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Você já tem um agendamento neste dia</DialogTitle>
            <DialogDescription>
              Pelo seu plano, só é possível ter um agendamento por dia. Em vez de criar um novo,
              reagende o existente para outro horário.
            </DialogDescription>
          </DialogHeader>
          {rescheduleSignal ? (
            <p className="text-muted-foreground text-sm">
              Horário atual:{' '}
              <strong>{formatLocalDateTime(rescheduleSignal.existingStartAt)}</strong>
            </p>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setRescheduleSignal(null)}>
              Voltar
            </Button>
            {whatsappHref ? (
              <Button asChild variant="outline">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  Falar no WhatsApp
                </a>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={toRoute(rescheduleSignal?.href ?? '/me/appointments')}>Reagendar</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}

function formatLocalDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

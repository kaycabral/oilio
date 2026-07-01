'use client'

import { buildWhatsappLink, type CancellationPolicy } from '@/domain'
import { createWizardBooking } from '@/features/self-book/adapters/wizard-book.actions'
import { formatNoticeWindow } from '@/features/self-book/core/format'
import { getClientAuth } from '@/shared/firebase/client'
import { toRoute } from '@/shared/routes'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cbrl/design'
import { signOut } from 'firebase/auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

// Step 3 of the self-book wizard (#844). All booking data (service, pro,
// startAt) is locked from the URL. Since brief 0077 (#1275) the confirm step
// carries NO customer PII: login is required and the Customer is derived from
// the authenticated uid. On success, navigates to /[slug]/[unitSlug]/book/success.
export function ConfirmBookingForm({
  slug,
  unitSlug,
  serviceId,
  memberOperationId,
  startAtIso,
  serviceLabel,
  memberOperationLabel,
  startAtLabel,
  cancellationPolicy,
  changeSlotHref,
  viewerName,
  unitWhatsapp,
  unitName,
}: {
  slug: string
  unitSlug: string
  serviceId: string
  memberOperationId: string
  startAtIso: string
  serviceLabel: string
  memberOperationLabel: string
  startAtLabel: string
  cancellationPolicy: CancellationPolicy
  changeSlotHref: string
  // Brief 0077 (#1275). Display-only name of the signed-in + completed viewer,
  // resolved server-side, so the confirm screen reads "Agendando como <nome>".
  // `null` means the viewer isn't logged in (or hasn't completed) — the action
  // returns `needs-login`/`needs-completion` and we route them to fix it.
  viewerName: string | null
  // Brief 0019 Group D — AC-17. Unit WhatsApp (normalized E.164 digits)
  // used to build the "Falar no WhatsApp" CTA shown when the booking
  // attempt is rejected because it's outside the customer's plan scope.
  // Unit name is interpolated into the pre-filled message so the
  // operator on the other end sees which shop the request belongs to.
  unitWhatsapp: string
  unitName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [switching, setSwitching] = useState(false)
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

  // Confirm CTA: one-click for a signed-in viewer; otherwise it kicks off the
  // login round-trip (#1275). Hoisted out of JSX to keep the label flat.
  let submitLabel = 'Confirmar agendamento'
  if (pending) submitLabel = 'Confirmando…'
  else if (!viewerName) submitLabel = 'Entrar e confirmar'

  // #1316 — the confirm screen inherits whatever session is already signed in.
  // A visitor booking on a shared/borrowed device (or the shop's own phone)
  // must be able to bail out of the wrong identity. Logging out mirrors the
  // user-menu logout, then routes back to /login with this booking URL as
  // `next`, so re-authenticating drops them right back on this confirm step.
  function onSwitchAccount() {
    setSwitching(true)
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    startTransition(async () => {
      await fetch('/api/session', { method: 'DELETE' })
      await signOut(getClientAuth()).catch(() => {})
      router.push(`/login?next=${next}`)
      router.refresh()
    })
  }

  function onSubmit(formData: FormData) {
    setError(null)
    setOutOfScope(null)
    setRescheduleSignal(null)
    formData.set('slug', slug)
    formData.set('unitSlug', unitSlug)
    formData.set('serviceId', serviceId)
    formData.set('memberOperationId', memberOperationId)
    formData.set('startAt', startAtIso)
    // Round-trip target so login/completion returns the visitor right back to
    // this confirm step with the booking context intact (#1275). Computed at
    // click time from the live URL — keeps any contextual attribution params.
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    startTransition(async () => {
      const res = await createWizardBooking(formData)
      if (res.ok) {
        router.push(`/${slug}/${unitSlug}/book/success?appt=${res.bookingId}`)
        return
      }
      // Login gate (#1275): nobody agenda sem login + cadastro completo. Route
      // to Google login or completar cadastro, returning to this booking URL.
      if ('kind' in res && res.kind === 'needs-login') {
        router.push(`/login?next=${next}`)
        return
      }
      if ('kind' in res && res.kind === 'needs-completion') {
        router.push(`/onboarding/profile?next=${next}`)
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
        <dd>{memberOperationLabel}</dd>
        <dt className="text-muted-foreground">Quando</dt>
        <dd>{startAtLabel}</dd>
      </dl>

      <Link
        href={toRoute(changeSlotHref)}
        className="text-primary -mt-2 self-start text-xs underline-offset-2 hover:underline"
      >
        ← Trocar horário
      </Link>

      {/* No customer PII inputs since #1275: login is required and the Customer
          is derived from the authenticated uid. Logged-in viewers see who they
          are agendando como; the rest get routed to login/completar cadastro on
          submit (the server action is the authority either way). */}
      {viewerName ? (
        <div className="text-muted-foreground border-border bg-muted/40 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span>
            Agendando como <strong>{viewerName}</strong>.
          </span>
          {/* #1316 — escape hatch out of an inherited session. */}
          <button
            type="button"
            onClick={onSwitchAccount}
            disabled={pending}
            className="text-primary self-start underline-offset-2 hover:underline disabled:opacity-60"
          >
            {switching ? 'Saindo…' : 'Não é você? Trocar de conta'}
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
          Você precisa entrar com sua conta pra confirmar. É rápido — seguimos do mesmo ponto.
        </p>
      )}

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
        {submitLabel}
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

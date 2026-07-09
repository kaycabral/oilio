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
  unitMobile,
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
  viewerName: string | null
  unitMobile: string
  unitName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outOfScope, setOutOfScope] = useState<string | null>(null)
  const [rescheduleSignal, setRescheduleSignal] = useState<{
    href: string
    existingStartAt: string
  } | null>(null)

  const whatsappHref = buildWhatsappLink(
    unitMobile,
    `Oi! Sou cliente assinante e gostaria de agendar em ${unitName} fora do meu plano. Pode me ajudar?`,
  )

  let submitLabel = 'Confirmar agendamento'
  if (pending) submitLabel = 'Confirmando…'
  else if (!viewerName) submitLabel = 'Entrar e confirmar'

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
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    startTransition(async () => {
      const res = await createWizardBooking(formData)
      if (res.ok) {
        router.push(`/${slug}/${unitSlug}/book/success?appt=${res.bookingId}`)
        return
      }
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

      {viewerName ? (
        <div className="text-muted-foreground border-border bg-muted/40 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span>
            Agendando como <strong>{viewerName}</strong>.
          </span>
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

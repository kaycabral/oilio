'use client'

import type { CancellationPolicy } from '@/domain'
import { createPublicBooking } from '@/features/self-book/adapters/book.actions'
import { formatBRL, formatDuration, formatNoticeWindow } from '@/features/self-book/core/format'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'

type ServiceOption = {
  id: string
  name: string
  durationMinutes: number
  priceCents: number
}

type MemberOperationOption = {
  id: string
  name: string
  unitName: string
}

export function BookingForm({
  slug,
  services,
  memberOperations,
  cancellationPolicy,
}: {
  slug: string
  services: ServiceOption[]
  memberOperations: MemberOperationOption[]
  cancellationPolicy: CancellationPolicy
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ bookingId: string } | null>(null)
  const startAtId = useId()

  function onSubmit(formData: FormData) {
    setError(null)
    formData.set('slug', slug)
    // Round-trip target so login/completion returns the visitor right back here
    // with the booking context intact (#1275).
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    startTransition(async () => {
      const res = await createPublicBooking(formData)
      if (res.ok) {
        setSuccess({ bookingId: res.bookingId })
        return
      }
      // Login gate (#1275): nobody agenda sem login + cadastro completo.
      if ('kind' in res && res.kind === 'needs-login') {
        router.push(`/login?next=${next}`)
        return
      }
      if ('kind' in res && res.kind === 'needs-completion') {
        router.push(`/onboarding/profile?next=${next}`)
        return
      }
      setError(res.error)
    })
  }

  if (success) {
    return (
      <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-700 dark:bg-emerald-950/40">
        <h2 className="text-base font-semibold">Agendamento confirmado!</h2>
        <p className="text-muted-foreground">
          Seu horário está reservado. Você pode acompanhar e cancelar pelo app. Pode fechar esta
          página.
        </p>
        <p className="text-muted-foreground text-xs">
          Código: <code>{success.bookingId.slice(0, 8)}</code>
        </p>
        <div className="pt-1">
          <Link href={`/${slug}`} className="text-primary text-sm underline">
            Voltar ao perfil
          </Link>
        </div>
      </div>
    )
  }

  if (memberOperations.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
        Sem profissionais ativos no momento.
      </p>
    )
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="book-service" className="text-sm font-medium">
          Serviço
        </Label>
        <Select name="serviceId" required>
          <SelectTrigger id="book-service">
            <SelectValue placeholder="Selecione um serviço" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {formatDuration(s.durationMinutes)} · {formatBRL(s.priceCents)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="book-memberOperation" className="text-sm font-medium">
          Profissional
        </Label>
        <Select name="memberOperationId" required>
          <SelectTrigger id="book-memberOperation">
            <SelectValue placeholder="Selecione um profissional" />
          </SelectTrigger>
          <SelectContent>
            {memberOperations.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {p.unitName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={startAtId} className="text-sm font-medium">
          Data e horário
        </Label>
        <Input id={startAtId} name="startAt" type="datetime-local" required />
      </div>

      {/* No customer PII inputs since #1275: login is required and the Customer
          is derived from the authenticated uid. Visitors who aren't logged in
          (or haven't completed) are routed to login/completar cadastro on submit
          and return right here — the server action is the authority. */}
      <p className="text-muted-foreground border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
        Pra confirmar, você entra com sua conta. Seus dados vêm do seu cadastro — sem digitar nome
        ou WhatsApp de novo.
      </p>

      {error ? (
        <p className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border p-2 text-sm">
          {error}
        </p>
      ) : null}

      {cancellationPolicy.enabled ? (
        <p className="text-muted-foreground text-xs">
          Você pode cancelar a qualquer momento pelo app. A unidade pede que cancelamentos sejam
          feitos com pelo menos {formatNoticeWindow(cancellationPolicy.minNoticeMinutes)} de
          antecedência.
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Enviando…' : 'Entrar e agendar'}
      </Button>
    </form>
  )
}

'use client'

import {
  blockMyDataInEstablishmentAction,
  blockMyDataInEstablishmentWarningAction,
} from '@/features/settings/adapters/privacy.actions'
import type { LinkedEstablishment } from '@/shared/identity/tenant-links'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// Self-service per-establishment CUSTOMER erasure (brief 0032 / AC-10, #1097).
// Lists the establishments the subject discovered via the reverse index. Each
// row offers "excluir meus dados deste estabelecimento" → a per-tenant block
// (#1100), wiring the active-subscription warning (#1101) so the subject gives
// informed consent before the destructive action. The whole-account erasure
// (#1093) lives in the sibling `DeleteMyDataForm`.
export function EstablishmentErasureList({
  establishments,
}: {
  establishments: LinkedEstablishment[]
}) {
  if (establishments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Você não é cliente de nenhum estabelecimento no momento.
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-md border" aria-label="Estabelecimentos">
      {establishments.map((est) => (
        <li key={est.tenantId} className="flex items-center justify-between gap-4 p-4">
          <span className="font-medium">{est.name}</span>
          <EraseInEstablishment establishment={est} />
        </li>
      ))}
    </ul>
  )
}

function EraseInEstablishment({ establishment }: { establishment: LinkedEstablishment }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [warning, setWarning] = useState<{ hasActiveSubscription: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // On open, fetch the informed-consent pre-check (#1101): does the subject have
  // an active subscription in this establishment that the block would cancel?
  function onOpenChange(next: boolean) {
    setOpen(next)
    setError(null)
    if (!next) {
      setWarning(null)
      return
    }
    setWarning(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('tenantId', establishment.tenantId)
      const res = await blockMyDataInEstablishmentWarningAction(fd)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setWarning({ hasActiveSubscription: res.hasActiveSubscription })
    })
  }

  function onConfirm() {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('tenantId', establishment.tenantId)
      const res = await blockMyDataInEstablishmentAction(fd)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      toast.success(
        res.cancelledActiveSubscription
          ? `Seus dados em ${establishment.name} foram excluídos e sua assinatura ativa foi cancelada.`
          : `Seus dados em ${establishment.name} foram excluídos.`,
      )
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        Excluir meus dados deste estabelecimento
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir dados em {establishment.name}</DialogTitle>
          <DialogDescription>
            Seus dados de cliente neste estabelecimento serão bloqueados (LGPD, art. 18). Você
            continua com sua conta nos demais estabelecimentos. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>

        {warning?.hasActiveSubscription ? (
          <p className="text-destructive text-sm font-medium">
            Você tem uma assinatura ativa neste estabelecimento. Ao confirmar, ela será cancelada
            imediatamente.
          </p>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Excluindo…' : 'Confirmar exclusão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

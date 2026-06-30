'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@cbrl/design'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { ClientInviteForm, type InviteUnitOption } from './ClientInviteForm'

// "Convidar cliente" opens from the top action of `/customers` as a dialog
// (mirrors `team/InviteDialog`, brief 0037), instead of a dedicated page. The
// recepcionista informs the WhatsApp + the unit; the form returns the contextual
// link in-place, so the dialog stays open to show + copy it.
export function ClientInviteDialog({
  units,
  trigger,
}: {
  // Bookable units (selfBookingPublished) the invite can target. Empty when none
  // is published yet — the invite would dead-end, so we explain that instead.
  units: InviteUnitOption[]
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserPlus className="h-4 w-4" />
            Convidar cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar cliente</DialogTitle>
          <DialogDescription>
            Informe a unidade e o WhatsApp do cliente e envie o convite. Ele faz o próprio cadastro
            pelo link — você não digita os dados dele.
          </DialogDescription>
        </DialogHeader>
        {units.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
            Nenhuma unidade com agendamento público ativo. Publique o agendamento de uma unidade pra
            poder convidar clientes.
          </p>
        ) : (
          <ClientInviteForm units={units} />
        )}
      </DialogContent>
    </Dialog>
  )
}

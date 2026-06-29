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
import { ClientInviteForm } from './ClientInviteForm'

// "Convidar cliente" opens from the top action of `/customers` as a dialog
// (mirrors `team/InviteDialog`, brief 0037), instead of a dedicated page. The
// recepcionista informs only the WhatsApp; the form returns the contextual link
// in-place, so the dialog stays open to show + copy it.
export function ClientInviteDialog({ trigger }: { trigger?: React.ReactNode }) {
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
            Informe o WhatsApp do cliente e envie o convite. Ele faz o próprio cadastro pelo link —
            você não digita os dados dele.
          </DialogDescription>
        </DialogHeader>
        <ClientInviteForm />
      </DialogContent>
    </Dialog>
  )
}

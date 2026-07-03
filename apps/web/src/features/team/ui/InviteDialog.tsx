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
import { InviteForm } from './InviteForm'

// AC-07 (brief 0037): "Convidar" is the primary action at the top of `/team`.
// The invite form opens from this top action (dialog) instead of sinking below
// the members list. Pending invites live in their own tab.
export function InviteDialog({ orgId, baseUrl }: { orgId: string; baseUrl: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>Gere um link de convite com o papel do novo membro.</DialogDescription>
        </DialogHeader>
        <InviteForm orgId={orgId} baseUrl={baseUrl} />
      </DialogContent>
    </Dialog>
  )
}

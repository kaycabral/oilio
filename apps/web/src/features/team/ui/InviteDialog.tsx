'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@oilio/design'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { InviteForm } from './InviteForm'

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

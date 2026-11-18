'use client'

import { defaultFirstUnitHours } from '@/features/units/core/unit-defaults'
import { DiscardConfirmDialog, UnitCreateWizard } from '@/features/units/ui/UnitCreateWizard'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@oilio/design'
import { useState } from 'react'

export function UnitFormDialog() {
  const [open, setOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  function onOpenChange(next: boolean) {
    if (!next && dirty) {
      setConfirmingDiscard(true)
      return
    }
    setOpen(next)
    if (!next) setDirty(false)
  }

  function discard() {
    setConfirmingDiscard(false)
    setOpen(false)
    setDirty(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline">+ Nova unidade</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova unidade</DialogTitle>
            <DialogDescription>Onde você atende. Você pode editar depois.</DialogDescription>
          </DialogHeader>
          <UnitCreateWizard
            defaults={{ businessHours: defaultFirstUnitHours() }}
            onDirtyChange={setDirty}
          />
        </DialogContent>
      </Dialog>
      <DiscardConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        onDiscard={discard}
      />
    </>
  )
}

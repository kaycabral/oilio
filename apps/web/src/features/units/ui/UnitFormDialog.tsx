'use client'

import { defaultFirstUnitHours } from '@/features/units/core/unit-defaults'
import { UnitForm } from '@/features/units/ui/UnitForm'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@cbrl/design'
import { useState } from 'react'

export function UnitFormDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">+ Nova unidade</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova unidade</DialogTitle>
          <DialogDescription>Onde você atende. Você pode editar depois.</DialogDescription>
        </DialogHeader>
        <UnitForm defaults={{ businessHours: defaultFirstUnitHours() }} />
      </DialogContent>
    </Dialog>
  )
}

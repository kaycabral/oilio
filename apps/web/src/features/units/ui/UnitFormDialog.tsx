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

// "+ Nova unidade" — creates a Unidade inline from the Negócios
// surface (PRD Identidade v2 — simplification): a normal dialog hosting the
// reusable `UnitForm`, NOT a separate page. Only the operating week is seeded
// (a Mon–Sat default); the owner names the unit themselves (a Negócio can hold
// several units, so defaulting the name to the Negócio name was misleading).
// `createUnit` redirects to `/organizations` on success, which closes the
// dialog via navigation.
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

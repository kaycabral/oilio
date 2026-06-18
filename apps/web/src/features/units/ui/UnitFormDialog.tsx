'use client'

import { defaultFirstUnitHours, defaultFirstUnitName } from '@/features/units/core/unit-defaults'
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

// "+ Nova unidade" — creates a Unidade inline from the Negócios & Unidades
// surface (PRD Identidade v2 — simplification): a normal dialog hosting the
// reusable `UnitForm`, NOT a separate page. The form is seeded with sensible
// defaults (unit name = Negócio name, a Mon–Sat operating week) so the owner
// only confirms address + WhatsApp. `createUnit` redirects to `/negocios` on
// success, which closes the dialog via navigation.
export function UnitFormDialog({ orgName }: { orgName: string }) {
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
        <UnitForm
          defaults={{
            name: defaultFirstUnitName(orgName),
            businessHours: defaultFirstUnitHours(),
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

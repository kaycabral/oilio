'use client'

import { VERTICALS, type Vertical } from '@/domain'
import { createOrg } from '@/features/onboarding/adapters/onboarding.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import { useOrg } from '@/shared/org/org-context'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useState, useTransition } from 'react'

const VERTICAL_LABELS: Record<Vertical, string> = {
  barbershop: 'Barbearia',
  auto_wash: 'Lavagem automotiva',
  auto_detailing: 'Estética automotiva',
  other: 'Outro',
}

// "+ Novo negócio" — creates another Negócio (folder) for the same user. Reuses
// the canonical `createOrg` saga (name + segment → folder WITHOUT a unit, the
// intentional empty state). On success this is a SMOOTH in-place context switch
// (no full reload): `setActiveOrg(orgId)` writes `currentOrgId` + `router.refresh()`
// (the exact mechanism `UnitOrgSwitcher` uses), then the dialog closes. We stay
// on the orgs page; it re-renders in the new Negócio's context.
export function NewOrgDialog() {
  const { setActiveOrg } = useOrg()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createOrg(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Soft context switch — set the new Negócio active (+ RSC refresh, handled
      // by the OrgProvider's setActiveOrg) and close the dialog. No navigation.
      await setActiveOrg(res.orgId)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Novo negócio</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo negócio</DialogTitle>
          <DialogDescription>Você pode mudar depois.</DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          action={onSubmit}
          onInput={refresh}
          onChange={refresh}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-org-name" className="text-sm font-medium">
              Nome do negócio
            </Label>
            <Input
              id="new-org-name"
              name="name"
              required
              minLength={2}
              placeholder="Barbearia do Bairro"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-org-vertical" className="text-sm font-medium">
              Segmento
            </Label>
            <Select name="vertical" required>
              <SelectTrigger id="new-org-vertical">
                <SelectValue placeholder="Escolha o segmento" />
              </SelectTrigger>
              <SelectContent>
                {VERTICALS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {VERTICAL_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !isValid}>
              {pending ? 'Criando…' : 'Criar negócio'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

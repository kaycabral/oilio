'use client'

import type { Professional, Service } from '@/domain'
import { setServiceProfessionals } from '@/features/catalog/adapters/catalog.actions'
import { Button, Checkbox } from '@cbrl/design'
import { useState, useTransition } from 'react'

// Cross-entry editor for the #876 link: from a service item's catalog editor,
// the owner flips which professionals execute it. Moved here from the deleted
// `/services` route (brief 0023, AC-10). Mirror of the multi-select inside
// ProfessionalForm — same data, two entry points (DRY of intent).
export function ServiceProfessionalsForm({
  service,
  professionals,
}: {
  service: Service
  professionals: Professional[]
}) {
  const serviceUnitSet = new Set(service.unitIds ?? [])
  const eligible = professionals.filter((p) => (p.unitIds ?? []).some((u) => serviceUnitSet.has(u)))
  const initial = new Set(
    eligible.filter((p) => (p.serviceIds ?? []).includes(service.id)).map((p) => p.id),
  )

  const [selected, setSelected] = useState<Set<string>>(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function onSave() {
    setError(null)
    setSavedAt(null)
    startTransition(async () => {
      const res = await setServiceProfessionals(service.id, Array.from(selected))
      if (!res.ok) setError(res.error)
      else setSavedAt(new Date().toLocaleTimeString('pt-BR'))
    })
  }

  if (professionals.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Cadastre profissionais primeiro em <strong>Profissionais</strong>.
      </p>
    )
  }
  if (eligible.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhum profissional atende nas unidades onde este serviço é oferecido. Ajuste em{' '}
        <strong>Profissionais</strong> ou nas unidades acima.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {eligible.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(p.id)}
              onCheckedChange={(checked) => toggle(p.id, checked === true)}
            />
            {p.name}
          </label>
        ))}
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {savedAt ? <p className="text-muted-foreground text-xs">Salvo às {savedAt}.</p> : null}
      <div className="flex justify-end pt-1">
        <Button type="button" size="sm" onClick={onSave} disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}

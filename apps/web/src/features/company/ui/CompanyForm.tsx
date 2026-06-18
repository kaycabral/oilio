'use client'

import { ORG_DESCRIPTION_MAX, VERTICALS, type Org, type Vertical } from '@/domain'
import { updateCompany } from '@/features/company/adapters/company.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@cbrl/design'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

const VERTICAL_LABELS: Record<Vertical, string> = {
  barbershop: 'Barbearia',
  auto_wash: 'Lavagem automotiva',
  auto_detailing: 'Estética automotiva',
  other: 'Outro',
}

export function CompanyForm({ org, canManage }: { org: Org; canManage: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateCompany(formData)
      if (!res.ok) setError(res.error)
      else toast.success('Empresa atualizada')
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-4"
    >
      <fieldset disabled={!canManage || pending} className="contents">
        <div className="flex flex-col gap-1">
          <Label htmlFor="company-name" className="text-sm font-medium">
            Nome
          </Label>
          <Input id="company-name" name="name" defaultValue={org.name} required minLength={2} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="company-slug" className="text-sm font-medium">
            Slug público
          </Label>
          <Input
            id="company-slug"
            name="slug"
            defaultValue={org.slug}
            required
            minLength={3}
            maxLength={64}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
          />
          <span className="text-muted-foreground text-xs">
            Identificador na URL pública. Apenas letras minúsculas, dígitos e hífens.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="company-vertical" className="text-sm font-medium">
            Vertical
          </Label>
          <Select name="vertical" defaultValue={org.vertical} required>
            <SelectTrigger id="company-vertical">
              <SelectValue />
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

        <fieldset className="border-border rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Identidade pública</legend>
          <p className="text-muted-foreground pt-2 pb-3 text-xs">
            Aparece na página pública <code>app/{org.slug || 'sua-empresa'}</code>. Logo e banner
            são URLs públicas (https://...) — hospedagem direta vem em iteração futura.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="company-brandingLogoUrl" className="text-sm font-medium">
                URL do logo
              </Label>
              <Input
                id="company-brandingLogoUrl"
                name="brandingLogoUrl"
                type="url"
                defaultValue={org.branding.logoUrl ?? ''}
                placeholder="https://..."
                maxLength={2048}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="company-brandingBannerUrl" className="text-sm font-medium">
                URL do banner
              </Label>
              <Input
                id="company-brandingBannerUrl"
                name="brandingBannerUrl"
                type="url"
                defaultValue={org.branding.bannerUrl ?? ''}
                placeholder="https://..."
                maxLength={2048}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Descrição curta</span>
              <Textarea
                name="brandingDescription"
                defaultValue={org.branding.description ?? ''}
                rows={3}
                maxLength={ORG_DESCRIPTION_MAX}
                placeholder="Apresente o estabelecimento em poucas linhas."
              />
              <span className="text-muted-foreground text-xs">
                Até {ORG_DESCRIPTION_MAX} caracteres.
              </span>
            </label>
          </div>
        </fieldset>

        {/* Cancellation policy + confirmation message moved to the per-unit
            agenda settings (PRD Identidade v2 — appointment-agenda concerns of
            the Unit, not the Org folder). */}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={pending || !canManage || !isValid}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}

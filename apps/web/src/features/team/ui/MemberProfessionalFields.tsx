'use client'

import { type CatalogServiceItem, type Professional, type StoredUnit } from '@/domain'
import {
  COMMISSION_KIND_LABELS,
  OPERATIONAL_LABELS,
  TAX_KIND_LABELS,
  type CommissionKind,
  type TaxKind,
} from '@/features/team/core/member-form'
import { Checkbox, Input, Label } from '@cbrl/design'
import { useId } from 'react'

// Identity + approval + commission fieldsets — rendered only while the member is
// (and stays) a professional. Split out so the form's render stays under the gate.
export function ProfessionalIdentityFields({
  professional,
  taxKind,
  setTaxKind,
  commissionKind,
  setCommissionKind,
  initialCommissionValue,
}: {
  professional: Professional
  taxKind: TaxKind
  setTaxKind: (k: TaxKind) => void
  commissionKind: CommissionKind
  setCommissionKind: (k: CommissionKind) => void
  initialCommissionValue: string
}) {
  const legalNameId = useId()
  return (
    <>
      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Identidade fiscal</legend>
        <div className="flex gap-3 py-2">
          {(['none', 'individual', 'company'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="taxKind"
                value={k}
                checked={taxKind === k}
                onChange={() => setTaxKind(k)}
              />
              {TAX_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {taxKind !== 'none' ? (
          <div className="flex flex-col gap-3 pt-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {taxKind === 'individual' ? 'CPF' : 'CNPJ'}
              </span>
              <Input
                name="taxId"
                defaultValue={professional?.taxIdentity?.taxId ?? ''}
                placeholder={taxKind === 'individual' ? '000.000.000-00' : '00.000.000/0000-00'}
                required
              />
            </label>
            {taxKind === 'company' ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={legalNameId} className="text-sm font-medium">
                  Razão social
                </Label>
                <Input
                  id={legalNameId}
                  name="legalName"
                  defaultValue={
                    professional?.taxIdentity?.kind === 'company'
                      ? professional.taxIdentity.legalName
                      : ''
                  }
                  required
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {/* Status operacional — read-only, DERIVADO de fatos reais (#1047). */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Status operacional</span>
        <span className="text-sm" role="group" aria-label="Status operacional">
          {OPERATIONAL_LABELS[professional.operationalStatus]}
        </span>
        <span className="text-muted-foreground text-xs">
          Derivado automaticamente: operacional quando o profissional tem WhatsApp, ao menos uma
          unidade e um serviço. Só então toma agendamentos e aparece na agenda pública.
        </span>
      </div>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Comissão padrão</legend>
        <div className="flex gap-3 py-2">
          {(['none', 'percentage', 'fixed'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="commissionKind"
                value={k}
                checked={commissionKind === k}
                onChange={() => setCommissionKind(k)}
              />
              {COMMISSION_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        {commissionKind !== 'none' ? (
          <label className="flex flex-col gap-1 pt-1">
            <span className="text-sm font-medium">
              {commissionKind === 'percentage' ? 'Percentual (%)' : 'Valor (R$)'}
            </span>
            <Input
              name="commissionValue"
              type="text"
              inputMode="decimal"
              defaultValue={initialCommissionValue}
              required
            />
          </label>
        ) : null}
      </fieldset>
    </>
  )
}

// Units + services scope fieldsets for a professional member.
export function ProfessionalScopeFields({
  units,
  selectedUnitIds,
  toggleUnit,
  unitTouched,
  services,
  eligibleServices,
  selectedServiceIds,
  toggleService,
  submittedServiceIds,
}: {
  units: StoredUnit[]
  selectedUnitIds: Set<string>
  toggleUnit: (id: string, checked: boolean) => void
  unitTouched: boolean
  services: CatalogServiceItem[]
  eligibleServices: CatalogServiceItem[]
  selectedServiceIds: Set<string>
  toggleService: (id: string, checked: boolean) => void
  submittedServiceIds: string[]
}) {
  return (
    <>
      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Unidades</legend>
        {units.length === 0 ? (
          <p className="text-muted-foreground text-sm">Cadastre unidades primeiro.</p>
        ) : (
          <div className="flex flex-col gap-1 pt-1">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="unitIds"
                  value={u.id}
                  checked={selectedUnitIds.has(u.id)}
                  onCheckedChange={(checked) => toggleUnit(u.id, checked === true)}
                />
                {u.name}
              </label>
            ))}
            {unitTouched && selectedUnitIds.size === 0 ? (
              <p className="text-destructive pt-1 text-xs">Selecione pelo menos 1 unidade.</p>
            ) : null}
          </div>
        )}
      </fieldset>

      <fieldset className="border-border rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Serviços que executa</legend>
        <ServicesPicker
          services={services}
          selectedUnitCount={selectedUnitIds.size}
          eligibleServices={eligibleServices}
          selectedServiceIds={selectedServiceIds}
          toggleService={toggleService}
        />
        {submittedServiceIds.map((sid) => (
          <input key={sid} type="hidden" name="catalogServiceIds" value={sid} />
        ))}
      </fieldset>
    </>
  )
}

// The services checklist has 3 empty-states before the actual picker — split out
// so the scope fieldset stays under the gate.
function ServicesPicker({
  services,
  selectedUnitCount,
  eligibleServices,
  selectedServiceIds,
  toggleService,
}: {
  services: CatalogServiceItem[]
  selectedUnitCount: number
  eligibleServices: CatalogServiceItem[]
  selectedServiceIds: Set<string>
  toggleService: (id: string, checked: boolean) => void
}) {
  if (services.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Cadastre serviços em <strong>Serviços</strong> antes — sem serviços não há o que linkar.
      </p>
    )
  }
  if (selectedUnitCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Selecione ao menos uma unidade acima — só aparecem aqui os serviços oferecidos nas unidades
        escolhidas.
      </p>
    )
  }
  if (eligibleServices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhum serviço oferecido nas unidades selecionadas. Habilite o serviço em
        <strong> Serviços → escolha a unidade</strong>.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1 pt-1">
      {eligibleServices.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selectedServiceIds.has(s.id)}
            onCheckedChange={(checked) => toggleService(s.id, checked === true)}
          />
          {s.name}
          {s.categoryId ? (
            <span className="text-muted-foreground text-xs">· {s.categoryId}</span>
          ) : null}
        </label>
      ))}
      <p className="text-muted-foreground pt-1 text-xs">
        Vazio = profissional aparece pra recepção marcar qualquer serviço, mas é invisível no
        catálogo público.
      </p>
    </div>
  )
}

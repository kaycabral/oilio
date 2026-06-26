'use client'

import { type CatalogServiceItem, type Professional, type Role, type StoredUnit } from '@/domain'
import { saveMemberDetail } from '@/features/team/adapters/team.actions'
import {
  computeEligibleServices,
  initialMemberUnitIds,
  memberCommissionValue,
  ROLE_OPTIONS,
  type CommissionKind,
  type TaxKind,
} from '@/features/team/core/member-form'
import { useOrg } from '@/shared/org/org-context'
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ProfessionalIdentityFields, ProfessionalScopeFields } from './MemberProfessionalFields'

// Single editable member-detail surface (brief 0037 refino, review 2026-06-02).
// There is NO "Editar" gate and NO separate "Trocar papel" button: an authorized
// user (owner/manager) editing a non-owner member sees the editable fields
// directly and persists everything with ONE Salvar.
//   - The role `<select>` sits at the top, replacing the static "Papel" label.
//   - For a professional member the operational fields follow (units/services/
//     commission/tax). Identity (name/whatsapp/email) is NOT repeated here —
//     it lives read-only at the top of the page (sourced from the User, #1046).
//   - One Salvar runs the role lifecycle (#1086) when the role changed AND the
//     operational update (#1085), via `saveMemberDetail`.
// Non-professional members get just the role select + Salvar (no operational
// fields). The owner is never rendered with this form (read-only — handled by
// the page).

export function MemberDetailForm({
  targetUserId,
  currentRole,
  statusLabel,
  professional,
  units,
  services = [],
}: {
  targetUserId: string
  currentRole: Role
  statusLabel: string
  professional: Professional | null
  units: StoredUnit[]
  services?: CatalogServiceItem[]
}) {
  const router = useRouter()
  const { activeUnitId } = useOrg()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [role, setRole] = useState<Role>(currentRole)
  const [taxKind, setTaxKind] = useState<TaxKind>(professional?.taxIdentity?.kind ?? 'none')
  const [commissionKind, setCommissionKind] = useState<CommissionKind>(
    professional?.defaultCommission?.kind ?? 'none',
  )
  // AC-03 (brief 0039): when the professional has NO units yet (new/empty),
  // pre-check the active unit while keeping the multi-select (definition stays
  // multi-unit — 0012). An existing selection is preserved as-is — the default
  // applies only to the empty case, never overwriting stored units.
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(() =>
    initialMemberUnitIds(professional, activeUnitId),
  )
  const [unitTouched, setUnitTouched] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    () => new Set(professional?.catalogServiceIds ?? []),
  )

  // The operational fields are shown only while the member is (and stays) a
  // professional. Switching role away from professional hides them (the save
  // runs the demotion lifecycle); switching toward professional materializes
  // the projection on save (operational config happens on the next visit).
  const showOperational =
    role === 'professional' && currentRole === 'professional' && professional !== null

  const eligibleServices = computeEligibleServices(services, selectedUnitIds)
  const eligibleServiceIds = new Set(eligibleServices.map((s) => s.id))
  const submittedServiceIds = Array.from(selectedServiceIds).filter((id) =>
    eligibleServiceIds.has(id),
  )

  function toggleService(serviceId: string, checked: boolean) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(serviceId)
      else next.delete(serviceId)
      return next
    })
  }

  function toggleUnit(unitId: string, checked: boolean) {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(unitId)
      else next.delete(unitId)
      return next
    })
    setUnitTouched(true)
  }

  const initialCommissionValue = memberCommissionValue(professional?.defaultCommission)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await saveMemberDetail({
        targetUserId,
        currentRole,
        newRole: role,
        professionalId: showOperational ? (professional?.id ?? null) : null,
        formData: showOperational ? formData : null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSaved(true)
      // The lifecycle (materialize/deactivate projection, re-derived role) and
      // the operational config both change what the detail renders — refresh.
      router.refresh()
    })
  }

  const operationalInvalid = showOperational && selectedUnitIds.size === 0

  return (
    <form action={onSubmit} className="flex flex-col gap-4" aria-label="Detalhes do membro">
      {/* The role field sits where the static "Papel" value used to be (refino):
          the static value becomes a `<select>`, but keeps its "Papel" label
          (form pattern + semantic test lookup). Status sits beside it,
          read-only. Changing the role + Salvar runs the role lifecycle (#1086). */}
      <section className="border-border flex flex-wrap items-start gap-x-8 gap-y-2 rounded-md border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="member-role" className="text-muted-foreground text-xs">
            Papel
          </Label>
          <Select
            name="role"
            value={role}
            onValueChange={(value) => {
              const next = ROLE_OPTIONS.find((o) => o.value === value)
              if (next) setRole(next.value)
            }}
          >
            <SelectTrigger id="member-role" className="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Status</span>
          {/* h-9 + centered so the value aligns with the select beside it. */}
          <span className="flex h-9 items-center text-sm" role="group" aria-label="Status">
            {statusLabel}
          </span>
        </div>
      </section>

      {showOperational && professional ? (
        <>
          <ProfessionalIdentityFields
            professional={professional}
            taxKind={taxKind}
            setTaxKind={setTaxKind}
            commissionKind={commissionKind}
            setCommissionKind={setCommissionKind}
            initialCommissionValue={initialCommissionValue}
          />
          <ProfessionalScopeFields
            units={units}
            selectedUnitIds={selectedUnitIds}
            toggleUnit={toggleUnit}
            unitTouched={unitTouched}
            services={services}
            eligibleServices={eligibleServices}
            selectedServiceIds={selectedServiceIds}
            toggleService={toggleService}
            submittedServiceIds={submittedServiceIds}
          />
        </>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {saved && !error ? <p className="text-sm text-emerald-600">Alterações salvas.</p> : null}

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={pending || operationalInvalid || (role === currentRole && !showOperational)}
          onClick={() => setUnitTouched(true)}
        >
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  )
}

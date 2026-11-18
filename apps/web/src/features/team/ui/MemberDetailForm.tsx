'use client'

import { type CatalogServiceItem, type MemberOperation, type Role, type StoredUnit } from '@/domain'
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
} from '@oilio/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MemberOperationIdentityFields, MemberOperationScopeFields } from './MemberOperationFields'

export function MemberDetailForm({
  targetUserId,
  currentRole,
  statusLabel,
  memberOperation,
  units,
  services = [],
}: {
  targetUserId: string
  currentRole: Role
  statusLabel: string
  memberOperation: MemberOperation | null
  units: StoredUnit[]
  services?: CatalogServiceItem[]
}) {
  const router = useRouter()
  const { activeUnitId } = useOrg()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [role, setRole] = useState<Role>(currentRole)
  const [taxKind, setTaxKind] = useState<TaxKind>(memberOperation?.taxIdentity?.kind ?? 'none')
  const [commissionKind, setCommissionKind] = useState<CommissionKind>(
    memberOperation?.defaultCommission?.kind ?? 'none',
  )
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(() =>
    initialMemberUnitIds(memberOperation, activeUnitId),
  )
  const [unitTouched, setUnitTouched] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    () => new Set(memberOperation?.catalogServiceIds ?? []),
  )

  const showOperational =
    role === 'member_operator' && currentRole === 'member_operator' && memberOperation !== null

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

  const initialCommissionValue = memberCommissionValue(memberOperation?.defaultCommission)

  function onSubmit(formData: FormData) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await saveMemberDetail({
        targetUserId,
        currentRole,
        newRole: role,
        memberOperationId: showOperational ? (memberOperation?.id ?? null) : null,
        formData: showOperational ? formData : null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  const operationalInvalid = showOperational && selectedUnitIds.size === 0

  return (
    <form action={onSubmit} className="flex flex-col gap-4" aria-label="Detalhes do membro">
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
          <span className="flex h-9 items-center text-sm" role="group" aria-label="Status">
            {statusLabel}
          </span>
        </div>
      </section>

      {showOperational && memberOperation ? (
        <>
          <MemberOperationIdentityFields
            memberOperation={memberOperation}
            taxKind={taxKind}
            setTaxKind={setTaxKind}
            commissionKind={commissionKind}
            setCommissionKind={setCommissionKind}
            initialCommissionValue={initialCommissionValue}
          />
          <MemberOperationScopeFields
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

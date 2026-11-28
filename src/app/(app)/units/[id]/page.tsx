import { Breadcrumbs } from '@/components/breadcrumbs'
import { isCompanyUnitFiscal, isUnitBookable } from '@/domain'
import { FiscalSection } from '@/features/company/ui/FiscalSection'
import { FormalizeFlow } from '@/features/company/ui/FormalizeFlow'
import { loadUnitForEdit } from '@/features/units/adapters/load-units'
import { UnitAgendaSettings } from '@/features/units/ui/UnitAgendaSettings'
import { UnitBookingQr } from '@/features/units/ui/UnitBookingQr'
import { UnitForm } from '@/features/units/ui/UnitForm'
import { UnitPublishCard } from '@/features/units/ui/UnitPublishCard'
import { toRoute } from '@/shared/routes'
import { Main, Typography } from '@cbrl/design'
import { connection } from 'next/server'

export const instant = false

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const { orgId, unit, org, unitTaxIdentity, canFormalize } = await loadUnitForEdit(id)

  function fiscalBlock() {
    if (isCompanyUnitFiscal(unit.fiscal)) {
      return <FiscalSection unit={unit} taxIdentity={unitTaxIdentity} />
    }
    if (canFormalize) return <FormalizeFlow unitId={unit.id} />
    return null
  }

  return (
    <Main width="narrow" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Negócios', href: toRoute('/organizations') },
          { label: unit.name, href: null },
        ]}
      />
      <Typography variant="pageTitle">Editar unidade</Typography>
      <UnitForm key={unit.updatedAt} unit={unit} />

      <UnitAgendaSettings unit={unit} />

      {fiscalBlock()}

      <UnitPublishCard orgId={orgId} unitId={unit.id} mode={unit.agenda.mode} />

      {isUnitBookable(unit) && org?.slug ? (
        <UnitBookingQr orgSlug={org.slug} unitSlug={unit.slug} unitName={unit.name} />
      ) : null}
    </Main>
  )
}

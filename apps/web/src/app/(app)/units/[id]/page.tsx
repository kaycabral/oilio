import { Breadcrumbs } from '@/components/breadcrumbs'
import { isUnitBookable } from '@/domain'
import { loadUnitForEdit } from '@/features/units/adapters/load-units'
import { UnitBookingQr } from '@/features/units/ui/UnitBookingQr'
import { UnitForm } from '@/features/units/ui/UnitForm'
import { UnitPublishCard } from '@/features/units/ui/UnitPublishCard'
import { Main, Typography } from '@cbrl/design'

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId, unit, org } = await loadUnitForEdit(id)

  return (
    <Main width="narrow" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Unidades', href: '/units' },
          { label: unit.name, href: null },
        ]}
      />
      <Typography variant="pageTitle">Editar unidade</Typography>
      <UnitForm unit={unit} />

      <UnitPublishCard orgId={orgId} unitId={unit.id} mode={unit.agenda.mode} />

      {isUnitBookable(unit) && org?.slug ? (
        <UnitBookingQr orgSlug={org.slug} unitSlug={unit.slug} unitName={unit.name} />
      ) : null}
    </Main>
  )
}

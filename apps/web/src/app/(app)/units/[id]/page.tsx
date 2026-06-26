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

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId, unit, org, unitTaxIdentity, canFormalize } = await loadUnitForEdit(id)

  // Fiscal identity lives on the unit (PRD Identidade v2). A formalized unit
  // shows the read-only section; an informal one shows the Formalizar CTA
  // (owner-only). The Negócio folder no longer carries any fiscal block.
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
      <UnitForm unit={unit} />

      {/* Agenda-mode-only settings (cancellation policy + messages, moved Org→Unit
          in C3) — render ONLY when the unit is in appointment mode. No global
          "Políticas" page anymore. */}
      <UnitAgendaSettings unit={unit} />

      {fiscalBlock()}

      <UnitPublishCard orgId={orgId} unitId={unit.id} mode={unit.agenda.mode} />

      {isUnitBookable(unit) && org?.slug ? (
        <UnitBookingQr orgSlug={org.slug} unitSlug={unit.slug} unitName={unit.name} />
      ) : null}
    </Main>
  )
}

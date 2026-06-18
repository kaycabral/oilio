import { isCompanyUnitFiscal } from '@/domain'
import { loadCompanyPage } from '@/features/company/adapters/load-company'
import { CompanyForm } from '@/features/company/ui/CompanyForm'
import { FiscalSection } from '@/features/company/ui/FiscalSection'
import { FormalizeFlow } from '@/features/company/ui/FormalizeFlow'
import { Main } from '@cbrl/design'

export default async function CompanyPage() {
  const { org, activeUnit, unitTaxIdentity, canManage, canFormalize } = await loadCompanyPage()

  // Fiscal identity lives on the active unit (PRD Identidade v2). A formalized
  // unit shows the read-only section; an informal one shows the Formalizar CTA
  // (owner-only). With no unit yet ("Negócio sem unidade"), no fiscal block.
  function fiscalBlock() {
    if (!activeUnit) return null
    if (isCompanyUnitFiscal(activeUnit.fiscal)) {
      return <FiscalSection unit={activeUnit} taxIdentity={unitTaxIdentity} />
    }
    if (canFormalize) return <FormalizeFlow unitId={activeUnit.id} />
    return null
  }

  return (
    <Main width="narrow" className="space-y-6">
      <h1 className="text-2xl font-semibold">Empresa</h1>
      {fiscalBlock()}
      <CompanyForm org={org} canManage={canManage} />
    </Main>
  )
}

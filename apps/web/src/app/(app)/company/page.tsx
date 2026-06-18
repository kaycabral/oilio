import { isCompanyFiscalProfile } from '@/domain'
import { loadCompanyPage } from '@/features/company/adapters/load-company'
import { CompanyForm } from '@/features/company/ui/CompanyForm'
import { FiscalSection } from '@/features/company/ui/FiscalSection'
import { FormalizeFlow } from '@/features/company/ui/FormalizeFlow'
import { Main } from '@cbrl/design'

export default async function CompanyPage() {
  const { org, canManage, canFormalize } = await loadCompanyPage()
  const formalized = isCompanyFiscalProfile(org.fiscalProfile)

  function fiscalBlock() {
    if (formalized) return <FiscalSection org={org} />
    if (canFormalize) return <FormalizeFlow />
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

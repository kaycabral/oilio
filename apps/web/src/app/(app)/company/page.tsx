import { loadCompanyPage } from '@/features/company/adapters/load-company'
import { CompanyForm } from '@/features/company/ui/CompanyForm'
import { Main } from '@cbrl/design'

export default async function CompanyPage() {
  const { tenant, canManage } = await loadCompanyPage()

  return (
    <Main width="narrow" className="space-y-6">
      <h1 className="text-2xl font-semibold">Empresa</h1>
      <CompanyForm tenant={tenant} canManage={canManage} />
    </Main>
  )
}

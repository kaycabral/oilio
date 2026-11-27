import { loadOrganizationsPage } from '@/features/company/adapters/load-organizations'
import { OrganizationsManager } from '@/features/company/ui/OrganizationsManager'
import { Main } from '@cbrl/design'

export const instant = false

export default async function OrganizationsPage() {
  const { org, units, orgs, canManage, canDelete } = await loadOrganizationsPage()

  return (
    <Main width="default">
      <OrganizationsManager
        org={org}
        units={units}
        orgs={orgs}
        canManage={canManage}
        canDelete={canDelete}
      />
    </Main>
  )
}

import { loadOrganizationsPage } from '@/features/company/adapters/load-organizations'
import { OrganizationsManager } from '@/features/company/ui/OrganizationsManager'
import { Main } from '@cbrl/design'

// Negócios (`/organizations` — the English domain term `Org`; "Negócios" is
// the user-facing label only) — the folder-manager surface (PRD Identidade v2,
// F5) that replaces the old "Empresa" page. Lists the user's Negócios, the active one
// expanded with its Unidades (name/address/agenda mode/fiscal badge), plus the
// create/edit affordances. The fiscal section lives on each Unidade's detail
// (`/units/[id]`), not here — the Negócio is a pure folder.
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

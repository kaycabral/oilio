import { loadBusinessPage } from '@/features/company/adapters/load-business'
import { BusinessManager } from '@/features/company/ui/BusinessManager'
import { Main } from '@cbrl/design'

// Negócios & Unidades (`/organizations` — the English domain term `Org`; "Negócios" is
// the user-facing label only) — the folder-manager surface (PRD Identidade v2,
// F5) that replaces the old "Empresa" page. Lists the user's Negócios, the active one
// expanded with its Unidades (name/address/agenda mode/fiscal badge), plus the
// create/edit affordances. The fiscal section lives on each Unidade's detail
// (`/units/[id]`), not here — the Negócio is a pure folder.
export default async function BusinessPage() {
  const { org, units, orgs, canManage, canDelete } = await loadBusinessPage()

  return (
    <Main width="default">
      <BusinessManager
        org={org}
        units={units}
        orgs={orgs}
        canManage={canManage}
        canDelete={canDelete}
      />
    </Main>
  )
}

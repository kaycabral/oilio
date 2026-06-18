import { redirect } from 'next/navigation'

// The "Empresa" page was retired (PRD Identidade v2 / F5). Its content split:
// the Negócio (folder) settings + the Negócios & Unidades folder-manager now
// live at `/organizations`; the fiscal identity moved to each Unidade's detail
// (`/units/[id]`). This stub keeps old links/bookmarks working.
export default function CompanyPageRedirect() {
  redirect('/organizations')
}

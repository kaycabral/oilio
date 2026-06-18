import { redirect } from 'next/navigation'

// The Unidades listing was folded into the single Negócios & Unidades surface
// (PRD Identidade v2 — simplification). The owner manages Unidades from
// `/organizations`; this route only forwards there so old links / bookmarks resolve.
export default function UnitsPage() {
  redirect('/organizations')
}

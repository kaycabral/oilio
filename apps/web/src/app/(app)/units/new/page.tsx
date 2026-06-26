import { redirect } from 'next/navigation'

// Unidade creation moved INTO the Negócios surface as an inline
// dialog (PRD Identidade v2 — simplification). This route forwards to
// `/organizations` so any deep link to the old create page lands on the new home.
export default function NewUnitPage() {
  redirect('/organizations')
}

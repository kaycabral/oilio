import { operatesCrossUnit } from '@/domain'
import { FirstUnitForm } from '@/features/units/ui/FirstUnitForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { listAccessibleUnits } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { Typography } from '@cbrl/design'
import { redirect } from 'next/navigation'

// Guided first-unit empty-state (PRD Identidade v2 / brief 0046, AC-03). The
// owner lands here right after signup — the Negócio (folder) exists with NO
// unit (the intentional empty state, AC-02). We present a friendly empty-state
// and the reusable unit form prefilled with sensible defaults so the owner
// effectively only confirms address + WhatsApp. Centering is inherited from the
// shared onboarding layout (CenteredScreen).
export default async function FirstUnitPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  // Only an owner/admin not pinned to a unit creates the first unit. A
  // unit-bound member never reaches this guided flow.
  if (!operatesCrossUnit(ctx.membership)) redirect('/dashboard')

  // Already has a unit (e.g. bookmarked link) — the guided empty-state is done,
  // send them into the app.
  const units = await listAccessibleUnits(ctx.membership)
  if (units.length > 0) redirect('/dashboard')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1">
        <Typography variant="pageTitle">Crie sua primeira unidade</Typography>
        <p className="text-muted-foreground text-sm">
          É onde você atende. Confirme o endereço, o horário e o WhatsApp — já deixamos o resto
          pronto pra você.
        </p>
      </header>
      <FirstUnitForm orgName={org.name} />
    </div>
  )
}

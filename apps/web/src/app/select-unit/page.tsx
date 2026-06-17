import { SelectUnitForm } from '@/features/select-unit/ui/SelectUnitForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { listAccessibleUnits } from '@/shared/tenant/active-unit'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { getTenant } from '@/shared/tenant/tenant'
import { redirect } from 'next/navigation'

/**
 * First-access interstitial (brief 0029, AC-04). The `(app)` layout redirects
 * here when a multi-unit member has no chosen unit yet. Lives OUTSIDE `(app)`
 * so the layout's redirect can't loop. A single-unit member (AC-05) or a tenant
 * with <2 units never reaches this — and if they land here directly, we resolve
 * straight into the app instead of showing a pointless selector.
 */
export default async function SelectUnitPage() {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  // Single-unit members are pinned (AC-05) — no choice to make.
  if (ctx.membership.unitId) redirect('/agenda')

  const units = await listAccessibleUnits(ctx.membership)
  // Nothing to choose: <2 units enters directly (the layout resolver picks the
  // single unit, or renders the empty state when there are none).
  if (units.length < 2) redirect('/agenda')

  const tenant = await getTenant(ctx.membership.tenantId)
  if (!tenant) redirect('/onboarding')

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
      <SelectUnitForm
        tenantName={tenant.name}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
      />
    </main>
  )
}

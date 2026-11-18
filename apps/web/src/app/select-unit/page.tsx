import { SelectUnitForm } from '@/features/select-unit/ui/SelectUnitForm'
import { isAuthConfigured } from '@/shared/auth/config'
import { getSessionUser } from '@/shared/auth/session'
import { listAccessibleUnits } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { redirect } from 'next/navigation'

export default async function SelectUnitPage() {
  if (!isAuthConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!ctx.user.completionCompleted) redirect('/onboarding/profile')

  if (ctx.membership.rlsUnitScope) redirect('/agenda')

  const units = await listAccessibleUnits(ctx.membership)
  if (units.length < 2) redirect('/agenda')

  const org = await getOrg(ctx.membership.orgId)
  if (!org) redirect('/onboarding')

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8">
      <SelectUnitForm orgName={org.name} units={units.map((u) => ({ id: u.id, name: u.name }))} />
    </main>
  )
}

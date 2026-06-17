import { Breadcrumbs } from '@/components/breadcrumbs'
import { operatesCrossUnit } from '@/domain'
import { UnitForm } from '@/features/units/ui/UnitForm'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveTenantContext } from '@/shared/tenant/membership'
import { Main } from '@cbrl/design'
import { redirect } from 'next/navigation'

export default async function NewUnitPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')
  // Same cross-unit gate as `/units` so a unit-bound manager can't deep-link
  // past the list to create units (brief 0039 AC-05).
  if (!operatesCrossUnit(ctx.membership)) redirect('/agenda')

  return (
    <Main width="narrow" className="space-y-4">
      <Breadcrumbs
        crumbs={[
          { label: 'Unidades', href: '/units' },
          { label: 'Nova', href: null },
        ]}
      />
      <h1 className="text-2xl font-semibold">Nova unidade</h1>
      <UnitForm />
    </Main>
  )
}

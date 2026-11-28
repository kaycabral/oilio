import { resolveScopeForSession } from '@/features/booking/adapters/subscription-scope.repo'
import { resolveCoveredServiceIds } from '@/features/self-book/adapters/covered-services'
import { getPublicOrgSummary, getPublicUnitBundle } from '@/features/self-book/adapters/public-org'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import { UnitCatalog } from '@/features/self-book/ui/UnitCatalog'
import { UnitPicker } from '@/features/self-book/ui/UnitPicker'
import { getSessionUser } from '@/shared/auth/session'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const summary = await getPublicOrgSummary(slug)
  if (!summary) return { title: 'Página não encontrada' }
  return {
    title: summary.org.name,
    description: summary.org.branding.description ?? `Agende com ${summary.org.name}.`,
  }
}

export default async function PublicOrgPage({ params }: PageProps) {
  await connection()
  const { slug } = await params

  const summary = await getPublicOrgSummary(slug)
  if (!summary) notFound()

  const { org, units } = summary
  if (units.length === 0) notFound()

  const scope = await resolveScopeForSession(org.id)
  const allowlist = scope?.unitAllowlist
  const visibleUnits = allowlist ? units.filter((u) => allowlist.has(u.id)) : units
  if (visibleUnits.length === 0) notFound()

  const coverageBanner = scope ? (
    <PlanCoverageBanner
      unitAllowlist={scope.unitAllowlist}
      allowedTimeScope={scope.allowedTimeScope}
      bookingLimits={scope.bookingLimits}
      units={units}
    />
  ) : null

  if (visibleUnits.length === 1) {
    const only = visibleUnits[0]!
    const bundle = await getPublicUnitBundle(slug, only.slug)
    if (!bundle) notFound()
    const session = await getSessionUser()
    const isLoggedIn = session !== null
    const coveredItemIds = resolveCoveredServiceIds({
      scope,
      catalogServiceItems: bundle.catalogServiceItems,
      orgId: bundle.org.id,
      unitId: bundle.unit.id,
      userId: session?.uid ?? null,
    })
    return (
      <UnitCatalog
        org={bundle.org}
        unit={bundle.unit}
        slug={slug}
        catalogServiceItems={bundle.catalogServiceItems}
        memberOperation={bundle.memberOperation}
        showUnitHeader={false}
        isLoggedIn={isLoggedIn}
        coveredItemIds={coveredItemIds}
        coverageBanner={coverageBanner}
      />
    )
  }

  return <UnitPicker org={org} units={visibleUnits} slug={slug} coverageBanner={coverageBanner} />
}

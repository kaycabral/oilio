import { resolveScopeForSession } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicOrgSummary, getPublicUnitBundle } from '@/features/self-book/adapters/public-org'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import { UnitCatalog } from '@/features/self-book/ui/UnitCatalog'
import { UnitPicker } from '@/features/self-book/ui/UnitPicker'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const revalidate = 60

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
  const { slug } = await params

  const summary = await getPublicOrgSummary(slug)
  if (!summary) notFound()

  const { org, units } = summary
  if (units.length === 0) notFound()

  // Spatial scope filter (brief 0019, Group A — AC-03/AC-04). If the
  // visitor has an active subscription in this org, narrow the
  // visible units to the union of plan allowlists. Avulso (no session)
  // and unrestricted snapshots see every unit, just like before.
  // We resolve the full scope (not just the allowlist) so the AC-16
  // coverage banner can render in a single read.
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

  // Single-unit orgs: short-circuit to the unit catalog so a one-shop
  // org doesn't force a needless hop. Multi-unit: render the picker.
  if (visibleUnits.length === 1) {
    const only = visibleUnits[0]!
    const bundle = await getPublicUnitBundle(slug, only.slug)
    if (!bundle) notFound()
    return (
      <UnitCatalog
        org={bundle.org}
        unit={bundle.unit}
        slug={slug}
        services={bundle.services}
        professional={bundle.professional}
        showUnitHeader={false}
        coverageBanner={coverageBanner}
      />
    )
  }

  return <UnitPicker org={org} units={visibleUnits} slug={slug} coverageBanner={coverageBanner} />
}

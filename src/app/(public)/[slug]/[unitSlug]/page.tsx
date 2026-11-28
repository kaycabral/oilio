import { resolveScopeForSession } from '@/features/booking/adapters/subscription-scope.repo'
import { resolveCoveredServiceIds } from '@/features/self-book/adapters/covered-services'
import { getPublicUnitBundle } from '@/features/self-book/adapters/public-org'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import { UnitCatalog } from '@/features/self-book/ui/UnitCatalog'
import { getSessionUser } from '@/shared/auth/session'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

function readMemberOperationQuery(
  sp: Record<string, string | string[] | undefined>,
): string | null {
  return readQuery(sp, 'memberOperation')
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, unitSlug } = await params
  const bundle = await getPublicUnitBundle(slug, unitSlug)
  if (!bundle) return { title: 'Página não encontrada' }
  return {
    title: `${bundle.unit.name} — ${bundle.org.name}`,
    description:
      bundle.org.branding.description ?? `Agende em ${bundle.unit.name} (${bundle.org.name}).`,
  }
}

export default function PublicUnitCatalogPage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <PublicUnitCatalogPageContent {...props} />
    </Suspense>
  )
}

async function PublicUnitCatalogPageContent({ params, searchParams }: PageProps) {
  await connection()
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const memberOperationId = readMemberOperationQuery(sp)

  const bundle = await getPublicUnitBundle(slug, unitSlug, {
    memberOperationId: memberOperationId ?? undefined,
  })
  if (!bundle) notFound()

  const scope = await resolveScopeForSession(bundle.org.id)
  if (scope?.unitAllowlist && !scope.unitAllowlist.has(bundle.unit.id)) notFound()

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
      showUnitHeader={bundle.units.length > 1}
      isLoggedIn={isLoggedIn}
      coveredItemIds={coveredItemIds}
      coverageBanner={
        scope ? (
          <PlanCoverageBanner
            unitAllowlist={scope.unitAllowlist}
            allowedTimeScope={scope.allowedTimeScope}
            bookingLimits={scope.bookingLimits}
            units={bundle.units}
          />
        ) : null
      }
    />
  )
}

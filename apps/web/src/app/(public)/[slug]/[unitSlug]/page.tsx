import { resolveScopeForSession } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicUnitBundle } from '@/features/self-book/adapters/public-tenant'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import { UnitCatalog } from '@/features/self-book/ui/UnitCatalog'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

function readProfessionalQuery(sp: Record<string, string | string[] | undefined>): string | null {
  return readQuery(sp, 'professional')
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, unitSlug } = await params
  const bundle = await getPublicUnitBundle(slug, unitSlug)
  if (!bundle) return { title: 'Página não encontrada' }
  return {
    title: `${bundle.unit.name} — ${bundle.tenant.name}`,
    description:
      bundle.tenant.branding.description ??
      `Agende em ${bundle.unit.name} (${bundle.tenant.name}).`,
  }
}

export default async function PublicUnitCatalogPage({ params, searchParams }: PageProps) {
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const professionalId = readProfessionalQuery(sp)

  const bundle = await getPublicUnitBundle(slug, unitSlug, {
    professionalId: professionalId ?? undefined,
  })
  if (!bundle) notFound()

  // Spatial scope guard (brief 0019, Group A — AC-03). When the visitor
  // has an active subscription in this tenant, prevent them from
  // landing on a unit outside the union allowlist via direct URL.
  // Avulso (no session) sees every unit — same as before. We resolve
  // the full scope (not just the allowlist) so we can render the AC-16
  // coverage banner without a second Firestore read.
  const scope = await resolveScopeForSession(bundle.tenant.id)
  if (scope?.unitAllowlist && !scope.unitAllowlist.has(bundle.unit.id)) notFound()

  return (
    <UnitCatalog
      tenant={bundle.tenant}
      unit={bundle.unit}
      slug={slug}
      services={bundle.services}
      professional={bundle.professional}
      showUnitHeader={bundle.units.length > 1}
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

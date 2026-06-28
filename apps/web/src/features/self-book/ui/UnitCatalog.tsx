import type { MemberOperation, Org, PublicCatalogItem, Unit } from '@/domain'
import { toRoute } from '@/shared/routes'
import { Button } from '@cbrl/design'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

// Catalog renderer for the public unit page (#841). Shared between
// `/{orgSlug}` (single-unit short-circuit) and
// `/{orgSlug}/{unitSlug}` (explicit unit). Pure presentation — all
// data loading lives in `getPublicUnitBundle`/`getPublicOrgSummary`.
export function UnitCatalog({
  org,
  unit,
  slug,
  catalogServiceItems,
  memberOperation,
  showUnitHeader,
  coverageBanner,
}: {
  org: Org
  unit: Unit
  slug: string
  catalogServiceItems: PublicCatalogItem[]
  memberOperation: MemberOperation | null
  // When true (multi-unit orgs), prepend the unit name + "Trocar unidade".
  // Hidden in single-unit mode where the page is the org landing.
  showUnitHeader: boolean
  // Brief 0019 Group D — AC-16. Optional banner rendered between the
  // unit header and the services list when the visitor has scope-bearing
  // subscription on this org. The parent decides what to show — keeps
  // this component pure (no Firestore reads).
  coverageBanner?: ReactNode
}) {
  const { branding } = org
  const hasBanner = branding.bannerUrl !== null

  return (
    <main className="mx-auto max-w-3xl pb-12">
      <section className="space-y-4">
        {hasBanner ? (
          <div className="bg-muted relative aspect-[16/6] w-full overflow-hidden">
            <Image
              src={branding.bannerUrl!}
              alt={`Banner de ${org.name}`}
              fill
              priority
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
              unoptimized
            />
          </div>
        ) : null}

        <header className="flex items-start gap-4 px-4 pt-4">
          {branding.logoUrl ? (
            <div className="bg-background border-background relative -mt-12 h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 shadow">
              <Image
                src={branding.logoUrl}
                alt={`Logo de ${org.name}`}
                fill
                className="object-cover"
                sizes="96px"
                unoptimized
              />
            </div>
          ) : null}
          <div className="flex-1 space-y-1 pt-2">
            <h1 className="text-2xl font-semibold">{org.name}</h1>
            {branding.description ? (
              <p className="text-muted-foreground text-sm">{branding.description}</p>
            ) : null}
          </div>
        </header>
      </section>

      {showUnitHeader ? (
        <section className="flex items-baseline justify-between gap-3 px-4 pt-6">
          <div>
            <h2 className="text-base font-semibold">{unit.name}</h2>
            {unit.address ? (
              <p className="text-muted-foreground text-xs">
                {[unit.address.street, unit.address.neighborhood, unit.address.city]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            ) : null}
          </div>
          <Link className="text-xs underline-offset-2 hover:underline" href={`/${slug}`}>
            Trocar unidade
          </Link>
        </section>
      ) : null}

      {coverageBanner ? <div className="px-4 pt-4">{coverageBanner}</div> : null}

      <section className="space-y-4 px-4 pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Serviços</h2>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/signup?from=${encodeURIComponent(slug)}`}>Cadastrar-se</Link>
            </Button>
          </div>
        </div>
        {catalogServiceItems.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Toque em um serviço para ver os horários disponíveis e agendar.
          </p>
        ) : null}

        {memberOperation ? (
          <div className="bg-muted/40 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs">
            <span>
              Filtrado por profissional: <strong>{memberOperation.name}</strong>
            </span>
            <Link
              className="underline-offset-2 hover:underline"
              href={`/${slug}/${unit.slug}`}
              aria-label="Limpar filtro de profissional"
            >
              Limpar filtro
            </Link>
          </div>
        ) : null}

        {catalogServiceItems.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            {memberOperation
              ? `${memberOperation.name} ainda não executa nenhum serviço público nesta unidade.`
              : 'Nenhum serviço público publicado ainda.'}
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-md border">
            {catalogServiceItems.map((s) => {
              const href =
                `/${slug}/${unit.slug}/availability?service=${encodeURIComponent(s.id)}` +
                (memberOperation
                  ? `&memberOperation=${encodeURIComponent(memberOperation.id)}`
                  : '')
              return (
                <li key={s.id}>
                  <Link
                    href={toRoute(href)}
                    className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-3 transition"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {s.durationMinutes !== null ? formatDuration(s.durationMinutes) : ''}
                        {s.categoryId ? ` · ${s.categoryId}` : ''}
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium tabular-nums">
                      {formatPrice(s.priceCents)}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="text-muted-foreground px-4 pt-12 text-center text-xs">
        Powered by Oilio
      </footer>
    </main>
  )
}

function formatPrice(cents: number | null): string {
  if (cents === null) return 'Sob consulta'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

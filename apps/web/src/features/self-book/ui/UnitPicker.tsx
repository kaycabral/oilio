import { type Org, type Unit } from '@/domain'
import { formatBrazilPhone } from '@cbrl/br/phone'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

export function UnitPicker({
  org,
  units,
  slug,
  coverageBanner,
}: {
  org: Org
  units: Unit[]
  slug: string
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

      {coverageBanner ? <div className="px-4 pt-4">{coverageBanner}</div> : null}

      <section className="space-y-3 px-4 pt-8">
        <h2 className="text-lg font-semibold">Escolha uma unidade</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {units.map((u) => (
            <li key={u.id}>
              <Link
                href={`/${slug}/${u.slug}`}
                className="hover:bg-muted/40 block rounded-md border p-4 transition"
              >
                <div className="text-sm font-medium">{u.name}</div>
                {u.address ? (
                  <p className="text-muted-foreground pt-1 text-xs">
                    {[u.address.street, u.address.neighborhood, u.address.city]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                ) : null}
                {u.mobile ? (
                  <p className="text-muted-foreground text-xs">
                    WhatsApp · {formatBrazilPhone(u.mobile)}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-muted-foreground px-4 pt-12 text-center text-xs">
        Powered by Oilio
      </footer>
    </main>
  )
}

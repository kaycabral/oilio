import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@cbrl/design'
import type { Route } from 'next'
import Link from 'next/link'

export type Crumb = {
  label: string
  href: Route | null
}

// Thin adapter over the design-system Breadcrumb primitives: takes a crumbs
// array and renders the shadcn structure (list/item/link/page/separator).
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <span key={`${i}-${crumb.label}`} className="inline-flex items-center gap-1.5">
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

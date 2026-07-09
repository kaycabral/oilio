import { permanentRedirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function CommissionReportRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') qs.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined) qs.set(key, value[0])
  }
  const query = qs.toString()
  permanentRedirect(query ? `/reports?${query}` : '/reports')
}

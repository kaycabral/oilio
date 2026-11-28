import { permanentRedirect } from 'next/navigation'
import { connection } from 'next/server'

export const instant = false

type SearchParams = Record<string, string | string[] | undefined>

export default async function CommissionReportRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await connection()
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') qs.set(key, value)
    else if (Array.isArray(value) && value[0] !== undefined) qs.set(key, value[0])
  }
  const query = qs.toString()
  permanentRedirect(query ? `/reports?${query}` : '/reports')
}

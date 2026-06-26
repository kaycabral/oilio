import { permanentRedirect } from 'next/navigation'

// Brief 0031 AC-05: o relatório de comissões virou seção do hub `/reports`. A
// rota antiga colapsa no hub — preserva os filtros (member/status/período) que
// o hub também lê. A lógica de carga vive em `../_lib/commissions-data.ts`
// (reaproveitada pela página `/reports`); as actions de "marcar pago" ficam em
// `./actions.ts`, consumidas pelo `<CommissionReport>` renderizado no hub.
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

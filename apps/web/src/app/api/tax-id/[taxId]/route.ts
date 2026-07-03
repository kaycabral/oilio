import { isValidCompanyTaxId, normalizeTaxId } from '@/domain'
import { BrasilApiCnpjResponse, normalizeCompanyLookup } from '@/shared/company/company-lookup'
import { readJson } from '@/shared/http'
import { withRequestContext } from '@/shared/lib/request-context'
import { Schema } from 'effect'
import { NextResponse } from 'next/server'

// 1d cache — CNPJ registry data changes rarely, but `situacao_cadastral` gates
// signup (brief 0046), so a shorter TTL than the 7d CEP cache keeps the ATIVA
// check reasonably fresh. BrasilAPI orchestrates Receita/MinhaReceita upstream.
export const revalidate = 86400

async function getHandler(_req: Request, { params }: { params: Promise<{ taxId: string }> }) {
  const { taxId: rawParam } = await params
  const taxId = normalizeTaxId(rawParam)
  if (!isValidCompanyTaxId(taxId)) {
    return NextResponse.json({ error: 'CNPJ inválido.' }, { status: 400 })
  }

  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${taxId}`, {
    next: { revalidate: 86400 },
  })
  if (res.status === 404) {
    return NextResponse.json({ error: 'CNPJ não encontrado.' }, { status: 404 })
  }
  if (!res.ok) {
    return NextResponse.json({ error: 'Falha na consulta do CNPJ.' }, { status: 502 })
  }

  const data = await readJson(res, Schema.decodeUnknownSync(BrasilApiCnpjResponse))
  return NextResponse.json(normalizeCompanyLookup(data, taxId))
}

export const GET = withRequestContext(getHandler)

import { normalizeTaxId } from '@/domain'
import { BrasilApiCnpjResponse, normalizeCompanyLookup } from '@/shared/company/company-lookup'
import { readJson } from '@/shared/http'
import { isValidCnpj } from '@cbrl/br/tax-id'
import { withRequestContext } from '@cbrl/log'
import { Schema } from 'effect'
import { NextResponse } from 'next/server'

async function getHandler(_req: Request, { params }: { params: Promise<{ taxId: string }> }) {
  const { taxId: rawParam } = await params
  const taxId = normalizeTaxId(rawParam)
  if (!isValidCnpj(taxId)) {
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

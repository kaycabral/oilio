import { readJson } from '@/shared/http'
import { Schema } from 'effect'
import { NextResponse } from 'next/server'

// BrasilAPI fields are optional here because every read below uses `?? fallback`
// — a partial response degrades to defaults rather than throwing.
const BrasilApiResponseSchema = Schema.Struct({
  cep: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  neighborhood: Schema.optional(Schema.String),
  street: Schema.optional(Schema.String),
})

export type PostalCodeLookup = {
  postalCode: string
  state: string
  city: string
  neighborhood: string
  street: string
}

// 7d cache — endereço muda raramente. Pattern copiado de apps/tekoa.
export const revalidate = 604800

export async function GET(_req: Request, { params }: { params: Promise<{ postalCode: string }> }) {
  const { postalCode: raw } = await params
  const normalized = raw.replace(/\D/g, '')
  if (!/^\d{8}$/.test(normalized)) {
    return NextResponse.json({ error: 'CEP inválido.' }, { status: 400 })
  }

  const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${normalized}`, {
    next: { revalidate: 604800 },
  })
  if (res.status === 404) {
    return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 })
  }
  if (!res.ok) {
    return NextResponse.json({ error: 'Falha na consulta do endereço.' }, { status: 502 })
  }

  const data = await readJson(res, Schema.decodeUnknownSync(BrasilApiResponseSchema))
  const result: PostalCodeLookup = {
    postalCode: (data.cep ?? normalized).replace(/\D/g, ''),
    state: data.state ?? '',
    city: data.city ?? '',
    neighborhood: data.neighborhood ?? '',
    street: data.street ?? '',
  }
  return NextResponse.json(result)
}

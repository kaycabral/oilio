import { lookupPostalCode } from '@cbrl/br/postal-code'
import { withRequestContext } from '@cbrl/log'
import { NextResponse } from 'next/server'

export const revalidate = 604800

const FAILURE = {
  invalid: { error: 'CEP inválido.', status: 400 },
  'not-found': { error: 'CEP não encontrado.', status: 404 },
  upstream: { error: 'Falha na consulta do endereço.', status: 502 },
} as const

async function getHandler(_req: Request, { params }: { params: Promise<{ postalCode: string }> }) {
  const { postalCode } = await params
  const result = await lookupPostalCode(postalCode, { init: { next: { revalidate } } })
  if (!result.ok) {
    const { error, status } = FAILURE[result.reason]
    return NextResponse.json({ error }, { status })
  }
  return NextResponse.json(result.address)
}

export const GET = withRequestContext(getHandler)

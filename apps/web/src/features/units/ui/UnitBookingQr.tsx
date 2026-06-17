import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cbrl/design'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { CopyPublicUrlButton } from './CopyPublicUrlButton'

// Booking-entry QR for a single unit (#864). Lives on the unit page since
// the QR is a unit-level artifact — it points at `/{tenantSlug}/{unitSlug}`,
// Step 1 of the self-book wizard (#844). Whoever scans lands straight on the
// unit's agenda; the customer record is created on booking confirmation.
export async function UnitBookingQr({
  tenantSlug,
  unitSlug,
  unitName,
}: {
  tenantSlug: string
  unitSlug: string
  unitName: string
}) {
  const baseUrl = await resolveBaseUrl()
  const url = `${baseUrl}/${tenantSlug}/${unitSlug}`
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 240,
    errorCorrectionLevel: 'M',
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">QR pra agendamento</CardTitle>
        <CardDescription>
          Cole no balcão, no Instagram ou em um flyer. Quem escaneia entra direto na agenda desta
          unidade — escolhe serviço, horário e confirma sem precisar pré-cadastrar nada. O cadastro
          acontece automaticamente na confirmação do agendamento.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div
          className="bg-background rounded-xl border p-4"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
          aria-label={`QR code para ${url}`}
        />
        <div className="space-y-0.5 text-center">
          <p className="text-sm font-medium">{unitName}</p>
          <p className="text-muted-foreground font-mono text-xs">/{unitSlug}</p>
        </div>
        <code className="bg-muted text-muted-foreground w-full max-w-xs truncate rounded-md px-3 py-1.5 text-center font-mono text-xs">
          {url}
        </code>
        <CopyPublicUrlButton url={url} />
      </CardContent>
    </Card>
  )
}

async function resolveBaseUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv) return stripTrailingSlash(fromEnv)
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (host) return `${proto}://${host}`
  return 'http://localhost:3005'
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

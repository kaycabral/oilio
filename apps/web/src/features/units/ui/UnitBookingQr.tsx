import { type BookingContext, buildClientInviteUrl } from '@/shared/invite/client-invite'
import { resolveBaseUrl } from '@/shared/site-url'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@oilio/design'
import QRCode from 'qrcode'
import { CopyPublicUrlButton } from './CopyPublicUrlButton'

export async function UnitBookingQr({
  orgSlug,
  unitSlug,
  unitName,
  booking,
  campaign,
}: {
  orgSlug: string
  unitSlug: string
  unitName: string
  booking?: BookingContext
  campaign?: string
}) {
  const baseUrl = await resolveBaseUrl()
  const intent = booking ? 'booking' : 'signup'
  const url = buildClientInviteUrl(baseUrl, {
    orgSlug,
    intent,
    booking,
    attribution: {
      source: 'qr',
      medium: 'invite',
      campaign: campaign ?? null,
      content: null,
      term: null,
      actorId: null,
      intent,
    },
  })
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
          {booking
            ? 'Serviço, profissional e horário já vêm escolhidos: quem escaneia faz login e confirma. O cadastro acontece automaticamente.'
            : 'Cole no balcão, no Instagram ou em um flyer. Quem escaneia entra na agenda desta unidade — escolhe serviço, horário, faz login e confirma. O cadastro acontece automaticamente.'}
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

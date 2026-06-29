import { type BookingContext, buildClientInviteUrl } from '@/shared/invite/client-invite'
import { resolveBaseUrl } from '@/shared/site-url'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cbrl/design'
import QRCode from 'qrcode'
import { CopyPublicUrlButton } from './CopyPublicUrlButton'

// Booking-entry QR for a single unit (#864, contextual since brief 0077 #1279).
// Lives on the unit page since the QR is a unit-level artifact. The URL now
// carries QR attribution (`source=qr`) so a scan is attributed to the QR channel
// (AC-06/AC-10), and — when a `booking` context is supplied — the chosen
// service/professional/slot are baked in so the scanner lands straight on the
// confirm step (the brief's "QR com serviço + profissional + horário"). Without a
// context it's the unit-level entry: pick service/slot on the unit agenda.
//
// PII-zero by construction: the QR encodes org/unit + service/pro/slot ids +
// attribution only — never a customer's name/phone (AC-06).
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
  // Optional fully-resolved booking context (service + pro + slot) — when present
  // the QR is contextual; when absent it's the unit entry point.
  booking?: BookingContext
  // Optional campaign slug to attribute the QR to a named campaign (flyer, promo).
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
      // A QR is anonymous physical media — no per-actor attribution.
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

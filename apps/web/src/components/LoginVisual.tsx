import { Avatar, AvatarFallback, Badge, Card, CardContent, Typography } from '@cbrl/design'

type AppointmentRow = {
  time: string
  customer: string
  initials: string
  service: string
}

const APPOINTMENTS: readonly AppointmentRow[] = [
  { time: '09:00', customer: 'Marcos A.', initials: 'MA', service: 'Corte + barba' },
  { time: '10:30', customer: 'Rafael T.', initials: 'RT', service: 'Corte' },
  { time: '14:00', customer: 'Bruno L.', initials: 'BL', service: 'Barba' },
]

export function LoginVisual() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4 p-8">
      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <Typography variant="small">Hoje</Typography>
            <Badge variant="secondary">3 agendamentos</Badge>
          </div>
          <div className="flex flex-col gap-3">
            {APPOINTMENTS.map((appointment) => (
              <div key={appointment.time} className="flex items-center gap-3">
                <Typography variant="muted" className="w-12 tabular-nums">
                  {appointment.time}
                </Typography>
                <Avatar className="size-8">
                  <AvatarFallback>{appointment.initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <Typography variant="small">{appointment.customer}</Typography>
                  <Typography variant="muted" className="text-xs">
                    {appointment.service}
                  </Typography>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Card className="flex-1 shadow-sm">
          <CardContent className="flex flex-col gap-1 p-5">
            <Typography variant="muted" className="text-xs">
              Assinantes ativos
            </Typography>
            <Typography variant="h3" className="tabular-nums">
              48
            </Typography>
            <Typography variant="muted" className="text-xs">
              +6 este mês
            </Typography>
          </CardContent>
        </Card>
        <Card className="flex-1 shadow-sm">
          <CardContent className="flex flex-col gap-1 p-5">
            <Typography variant="muted" className="text-xs">
              Recebido no mês
            </Typography>
            <Typography variant="h3" className="tabular-nums">
              R$ 12.480
            </Typography>
            <Typography variant="muted" className="text-xs">
              Meta: R$ 15.000
            </Typography>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

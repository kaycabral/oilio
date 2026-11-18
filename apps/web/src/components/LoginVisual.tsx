import {
  Avatar,
  AvatarFallback,
  Badge,
  Card,
  CardContent,
  Separator,
  Typography,
} from '@oilio/design'

type MontageTile = { key: string; node: React.ReactNode }

function AgendaTile() {
  const rows = [
    { time: '09:00', customer: 'Marcos A.', initials: 'MA', service: 'Corte + barba' },
    { time: '10:30', customer: 'Rafael T.', initials: 'RT', service: 'Corte' },
    { time: '14:00', customer: 'Bruno L.', initials: 'BL', service: 'Barba' },
  ]
  return (
    <Card className="w-72 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Typography variant="small">Hoje</Typography>
          <Badge variant="secondary">3 agendamentos</Badge>
        </div>
        {rows.map((row) => (
          <div key={row.time} className="flex items-center gap-3">
            <Typography variant="muted" className="w-11 text-xs tabular-nums">
              {row.time}
            </Typography>
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <Typography variant="small">{row.customer}</Typography>
              <Typography variant="muted" className="text-xs">
                {row.service}
              </Typography>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="w-44 shadow-sm">
      <CardContent className="flex flex-col gap-1 p-4">
        <Typography variant="muted" className="text-xs">
          {label}
        </Typography>
        <Typography variant="h3" className="tabular-nums">
          {value}
        </Typography>
        <Typography variant="muted" className="text-xs">
          {hint}
        </Typography>
      </CardContent>
    </Card>
  )
}

function OrderTile() {
  const items = [
    { name: 'Corte degradê', price: 'R$ 45,00' },
    { name: 'Barba', price: 'R$ 30,00' },
    { name: 'Pomada', price: 'R$ 38,00' },
  ]
  return (
    <Card className="w-64 shadow-sm">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <Typography variant="small">Comanda 42</Typography>
          <Badge>Aberta</Badge>
        </div>
        {items.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <Typography variant="muted" className="text-xs">
              {item.name}
            </Typography>
            <Typography variant="muted" className="text-xs tabular-nums">
              {item.price}
            </Typography>
          </div>
        ))}
        <Separator />
        <div className="flex items-center justify-between">
          <Typography variant="small">Total</Typography>
          <Typography variant="small" className="tabular-nums">
            R$ 113,00
          </Typography>
        </div>
      </CardContent>
    </Card>
  )
}

function SubscriptionTile() {
  return (
    <Card className="w-60 shadow-sm">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <Typography variant="small">Plano Barba em dia</Typography>
          <Badge variant="secondary">Ativo</Badge>
        </div>
        <Typography variant="muted" className="text-xs">
          4 de 6 usos no mês
        </Typography>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div className="bg-primary h-full w-2/3 rounded-full" />
        </div>
        <Typography variant="muted" className="text-xs">
          Renova em 12 dias
        </Typography>
      </CardContent>
    </Card>
  )
}

function CommissionTile() {
  const people = [
    { name: 'Diego', initials: 'DS', amount: 'R$ 1.240' },
    { name: 'Paulo', initials: 'PM', amount: 'R$ 980' },
  ]
  return (
    <Card className="w-56 shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4">
        <Typography variant="small">Comissões do mês</Typography>
        {people.map((person) => (
          <div key={person.name} className="flex items-center gap-2">
            <Avatar className="size-6">
              <AvatarFallback className="text-[10px]">{person.initials}</AvatarFallback>
            </Avatar>
            <Typography variant="muted" className="flex-1 text-xs">
              {person.name}
            </Typography>
            <Typography variant="muted" className="text-xs tabular-nums">
              {person.amount}
            </Typography>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function CashTile() {
  return (
    <Card className="w-52 shadow-sm">
      <CardContent className="flex flex-col gap-1 p-4">
        <Typography variant="muted" className="text-xs">
          Caixa de hoje
        </Typography>
        <Typography variant="h3" className="tabular-nums">
          R$ 1.860
        </Typography>
        <div className="flex gap-2">
          <Badge variant="secondary">Pix 62%</Badge>
          <Badge variant="secondary">Cartão 38%</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

function CustomerTile() {
  return (
    <Card className="w-56 shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <Avatar className="size-10">
          <AvatarFallback>CS</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <Typography variant="small">Carla S.</Typography>
          <Typography variant="muted" className="text-xs">
            Assinante há 8 meses
          </Typography>
        </div>
      </CardContent>
    </Card>
  )
}

const MONTAGE_TILES: readonly MontageTile[] = [
  { key: 'agenda-1', node: <AgendaTile /> },
  {
    key: 'subscribers',
    node: <StatTile label="Assinantes ativos" value="48" hint="+6 este mês" />,
  },
  { key: 'order-1', node: <OrderTile /> },
  { key: 'subscription-1', node: <SubscriptionTile /> },
  { key: 'cash-1', node: <CashTile /> },
  { key: 'commission-1', node: <CommissionTile /> },
  {
    key: 'revenue',
    node: <StatTile label="Recebido no mês" value="R$ 12.480" hint="Meta: R$ 15.000" />,
  },
  { key: 'customer-1', node: <CustomerTile /> },
  { key: 'agenda-2', node: <AgendaTile /> },
  { key: 'order-2', node: <OrderTile /> },
  { key: 'retention', node: <StatTile label="Retorno em 30d" value="72%" hint="+4 p.p." /> },
  { key: 'subscription-2', node: <SubscriptionTile /> },
  { key: 'commission-2', node: <CommissionTile /> },
  { key: 'cash-2', node: <CashTile /> },
  {
    key: 'ticket',
    node: <StatTile label="Ticket médio" value="R$ 78" hint="+R$ 6 vs mês passado" />,
  },
  { key: 'customer-2', node: <CustomerTile /> },
]

export function LoginVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 flex h-[160%] w-[170%] -translate-x-1/2 -translate-y-1/2 -rotate-12 flex-wrap content-center justify-center gap-5">
        {MONTAGE_TILES.map((tile) => (
          <div key={tile.key} className="shrink-0">
            {tile.node}
          </div>
        ))}
        {MONTAGE_TILES.map((tile) => (
          <div key={`${tile.key}-fill`} className="shrink-0">
            {tile.node}
          </div>
        ))}
      </div>
    </div>
  )
}

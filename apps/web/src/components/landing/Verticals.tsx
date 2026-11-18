import { Badge, Typography } from '@oilio/design'

const ACTIVE = [
  { name: 'Barbearia', description: 'Cortes, planos mensais e comissão por barbeiro.' },
  {
    name: 'Estética automotiva',
    description: 'Lavagens, detailing e pacotes de manutenção recorrente.',
  },
] as const

const SOON = ['Pet', 'Fitness', 'Autocenter'] as const

export function Verticals() {
  return (
    <section className="flex flex-col gap-10 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Pensado pro seu tipo de negócio
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          A mesma plataforma atende categorias bem diferentes — porque o que elas têm em comum é a
          receita recorrente.
        </Typography>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {ACTIVE.map((vertical) => (
          <div
            key={vertical.name}
            className="border-border flex flex-col gap-2 rounded-lg border p-6"
          >
            <div className="flex items-center gap-2">
              <Typography variant="large">{vertical.name}</Typography>
              <Badge>Ativo</Badge>
            </div>
            <Typography variant="muted" className="text-base">
              {vertical.description}
            </Typography>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Typography variant="muted">Em breve:</Typography>
        {SOON.map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
      </div>
    </section>
  )
}

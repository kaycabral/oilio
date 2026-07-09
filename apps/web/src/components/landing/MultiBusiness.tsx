import { Typography } from '@cbrl/design'
import { KeyRound, Layers, Wallet } from 'lucide-react'

const POINTS = [
  {
    icon: KeyRound,
    title: 'Um login para todos',
    description:
      'Barbearia de manhã, lava-rápido à tarde. Você alterna entre os negócios num clique — sem sair, sem outra conta, sem outra senha.',
  },
  {
    icon: Wallet,
    title: 'Cada negócio no seu plano',
    description:
      'Um pode ser Grátis enquanto o outro está no Pro. Cada negócio tem a própria agenda, equipe e cobrança — nada se mistura.',
  },
  {
    icon: Layers,
    title: 'Cresça sem recomeçar',
    description:
      'Abriu um negócio novo? Ele entra na mesma conta em segundos. Você não monta tudo de novo nem aprende outra ferramenta.',
  },
] as const

export function MultiBusiness() {
  return (
    <section className="bg-muted my-16 flex flex-col gap-10 rounded-2xl px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Tem mais de um negócio? Gerencie todos num login
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          Toque negócios diferentes na mesma conta — cada um com a sua agenda, equipe e cobrança.
          Chega de fazer malabarismo com logins e planilhas separadas.
        </Typography>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.title} className="flex flex-col gap-2">
            <point.icon aria-hidden className="text-foreground/70 size-5" strokeWidth={2} />
            <Typography variant="large">{point.title}</Typography>
            <Typography variant="muted" className="text-base">
              {point.description}
            </Typography>
          </div>
        ))}
      </div>
    </section>
  )
}

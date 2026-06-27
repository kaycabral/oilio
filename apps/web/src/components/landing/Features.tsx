import { Card, CardContent, CardDescription, CardTitle, Typography } from '@cbrl/design'

const FEATURES = [
  {
    title: 'Agenda inteligente',
    description:
      'Horários, profissionais e unidades num só calendário. Self-booking pros clientes marcarem sozinhos, sem telefone.',
  },
  {
    title: 'Assinatura nativa',
    description:
      'Planos recorrentes de verdade — não um remendo. Cobre todo mês, controle renovações e veja sua receita previsível crescer.',
  },
  {
    title: 'Comissão por profissional',
    description:
      'Comissão calculada na hora do fechamento da comanda. Cada um vê o que tem a receber e você controla a liquidação, sem planilha.',
  },
  {
    title: 'Multi-unidade',
    description:
      'Opere várias unidades sob uma mesma organização, com equipe, catálogo e relatórios isolados por filial.',
  },
] as const

export function Features() {
  return (
    <section className="flex flex-col gap-10 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Tudo que o seu negócio precisa
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          Da marcação ao recebimento, numa plataforma só — sem juntar três ferramentas que não
          conversam.
        </Typography>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <Card key={feature.title}>
            <CardContent className="flex flex-col gap-2 pt-6">
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription className="text-base">{feature.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

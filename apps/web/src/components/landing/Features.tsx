import { Card, CardContent, CardDescription, CardTitle, Typography } from '@cbrl/design'

const FEATURES = [
  {
    title: 'Encha a agenda sozinho',
    description:
      'Horários, profissionais e unidades num calendário só. Seus clientes marcam pelo link público — sem você atender telefone.',
  },
  {
    title: 'Cobre todo mês, no automático',
    description:
      'Assinatura nativa, não um remendo. Você lança planos recorrentes, controla renovações e vê a receita previsível entrar.',
  },
  {
    title: 'Feche a comanda e a comissão sai pronta',
    description:
      'A comissão é calculada na hora do fechamento. Cada profissional vê o que tem a receber e você liquida sem planilha.',
  },
  {
    title: 'Comande várias unidades de um lugar',
    description:
      'Opere cada filial sob a mesma organização, com equipe, catálogo e relatórios isolados. Você cresce sem perder o controle.',
  },
] as const

export function Features() {
  return (
    <section className="flex flex-col gap-10 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Faça tudo num lugar só
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          Da marcação ao recebimento, sem juntar três ferramentas que não conversam entre si.
        </Typography>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

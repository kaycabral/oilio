import { Typography } from '@oilio/design'

const STEPS = [
  {
    step: '01',
    title: 'Comece pelo avulso',
    description:
      'Cadastre serviços e equipe e já comece a marcar e fechar atendimentos hoje — sem fricção, sem migração complicada.',
  },
  {
    step: '02',
    title: 'Fidelize com recorrência',
    description:
      'Transforme quem sempre volta em cliente de plano: pacotes, retornos agendados e lembretes que trazem todo mundo de novo.',
  },
  {
    step: '03',
    title: 'Escale com assinatura',
    description:
      'Lance planos nativos com cobrança automática e pare de perguntar "quanto vendi esse mês?". A resposta você já sabe.',
  },
] as const

export function HowItWorks() {
  return (
    <section className="flex flex-col gap-10 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Typography as="h2" variant="h2" className="border-none pb-0">
          Vá do avulso à assinatura no seu ritmo
        </Typography>
        <Typography variant="muted" className="max-w-prose text-base">
          Você não precisa virar a chave de uma vez. O Oilio acompanha cada estágio do seu negócio.
        </Typography>
      </div>
      <ol className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((item) => (
          <li key={item.step} className="flex flex-col gap-2">
            <span className="text-muted-foreground font-mono text-sm font-semibold">
              {item.step}
            </span>
            <Typography variant="large">{item.title}</Typography>
            <Typography variant="muted" className="text-base">
              {item.description}
            </Typography>
          </li>
        ))}
      </ol>
      <Typography variant="muted" className="text-center">
        Dados dos seus clientes protegidos e em conformidade com a LGPD desde o primeiro cadastro.
      </Typography>
    </section>
  )
}

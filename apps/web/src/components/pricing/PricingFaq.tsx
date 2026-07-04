import { Typography } from '@cbrl/design'

// FAQ canônico de pricing — fonte de verdade na Wiki
// [Estrategia/Modelo-de-Receita § 5].
const FAQ = [
  {
    question: 'Como funciona a cobrança por unidade?',
    answer:
      'Você paga por unidade (loja) ativa. A primeira unidade tem o preço do plano e cada unidade extra entra com desconto. Nos planos pagos, a equipe é ilimitada. O plano Grátis cobre uma unidade para sempre.',
  },
  {
    question: 'Tenho mais de um negócio. Dá para gerenciar tudo junto?',
    answer:
      'Sim. Você gerencia várias empresas num único login, alternando entre elas quando quiser. Cada empresa tem a sua assinatura — pode ser Grátis numa e Pro em outra.',
  },
  {
    question: 'Qual a vantagem do plano anual?',
    answer:
      'No anual você ganha 2 meses grátis: paga 10 meses e usa 12. O valor mostrado já é o equivalente por mês, cobrado uma vez por ano.',
  },
  {
    question: 'Preciso usar assinaturas para começar?',
    answer:
      'Não. Você começa só com agenda e atendimentos avulsos no Grátis e ativa os planos de assinatura no Pro quando fizer sentido para o seu negócio.',
  },
] as const

export function PricingFaq() {
  return (
    <section className="flex flex-col gap-8 py-16">
      <Typography as="h2" variant="h2" className="border-none pb-0 text-center">
        Perguntas frequentes
      </Typography>
      <dl className="mx-auto grid w-full max-w-3xl gap-6 sm:grid-cols-2">
        {FAQ.map((item) => (
          <div key={item.question} className="flex flex-col gap-2">
            <dt>
              <Typography variant="large">{item.question}</Typography>
            </dt>
            <dd>
              <Typography variant="muted" className="text-base">
                {item.answer}
              </Typography>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

import { Typography } from '@cbrl/design'

// Perguntas placeholder — revisar quando o brief de pricing definir a
// estratégia comercial real.
const FAQ = [
  {
    question: 'Quem pode criar uma conta no Oilio?',
    answer:
      'Hoje o cadastro é feito pelo estabelecimento. Profissionais, membros da equipe e clientes entram a partir de um estabelecimento já existente.',
  },
  {
    question: 'Os preços já são definitivos?',
    answer:
      'Ainda não. Estes valores são um rascunho e podem mudar antes do lançamento. Quem entrar agora será avisado de qualquer alteração.',
  },
  {
    question: 'Preciso usar assinaturas para começar?',
    answer:
      'Não. Você pode começar só com agenda e atendimentos avulsos e ativar assinaturas quando fizer sentido para o seu negócio.',
  },
  {
    question: 'Dá para gerenciar mais de uma unidade?',
    answer:
      'Sim. O Oilio é multi-unidade — cada filial tem equipe, catálogo e relatórios isolados sob a mesma organização.',
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

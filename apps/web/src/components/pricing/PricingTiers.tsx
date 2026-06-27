import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Badge, Button, Card, CardContent, Typography, cn } from '@cbrl/design'

// Rascunho de pricing — valores e limites são placeholders até o brief
// definir a estratégia de planos. Estrutura inspirada no pricing do Notion
// (3 tiers, um recomendado, features incrementais "tudo do plano anterior, +").
type Tier = {
  name: string
  priceLabel: string
  priceSuffix?: string
  description: string
  cta: string
  highlighted?: boolean
  features: readonly string[]
}

const TIERS: readonly Tier[] = [
  {
    name: 'Starter',
    priceLabel: 'Grátis',
    description: 'Para começar a organizar a agenda do seu estabelecimento.',
    cta: 'Começar grátis',
    features: [
      'Agenda e atendimentos avulsos',
      'Até 1 unidade',
      'Cadastro de serviços e clientes',
      'Self-booking básico',
    ],
  },
  {
    name: 'Pro',
    priceLabel: 'R$ 0',
    priceSuffix: '/mês por unidade',
    description: 'Para quem quer transformar clientes em receita recorrente.',
    cta: 'Assinar o Pro',
    highlighted: true,
    features: [
      'Tudo do Starter, e mais:',
      'Assinaturas e planos recorrentes',
      'Split fiscal e comissão por profissional',
      'Equipe com papéis e permissões',
      'Relatórios de receita recorrente',
    ],
  },
  {
    name: 'Avançado',
    priceLabel: 'R$ 0',
    priceSuffix: '/mês por unidade',
    description: 'Para operações com várias unidades e equipes maiores.',
    cta: 'Falar com a gente',
    features: [
      'Tudo do Pro, e mais:',
      'Multi-unidade sem limite',
      'Controles avançados de equipe',
      'Relatórios consolidados',
      'Suporte prioritário',
    ],
  },
] as const

export function PricingTiers() {
  const authEnabled = isFirebaseConfigured()

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {TIERS.map((tier) => (
        <Card
          key={tier.name}
          className={cn(
            'flex flex-col',
            tier.highlighted && 'border-foreground/30 ring-foreground/10 shadow-md ring-1',
          )}
        >
          <CardContent className="flex flex-1 flex-col gap-6 pt-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Typography variant="large">{tier.name}</Typography>
                {tier.highlighted && <Badge>Recomendado</Badge>}
              </div>
              <div className="flex items-baseline gap-1">
                <Typography as="span" variant="h2" className="border-none pb-0">
                  {tier.priceLabel}
                </Typography>
                {tier.priceSuffix && (
                  <Typography as="span" variant="muted">
                    {tier.priceSuffix}
                  </Typography>
                )}
              </div>
              <Typography variant="muted" className="text-base">
                {tier.description}
              </Typography>
            </div>

            {authEnabled && (
              <Button asChild variant={tier.highlighted ? 'default' : 'outline'} className="w-full">
                <a href="/login">{tier.cta}</a>
              </Button>
            )}

            <ul className="flex flex-col gap-2">
              {tier.features.map((feature) => (
                <li key={feature} className="text-muted-foreground text-sm">
                  {feature}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

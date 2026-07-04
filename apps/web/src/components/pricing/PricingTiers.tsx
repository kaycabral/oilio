'use client'

import { TIERS as BILLING_TIERS, type Tier as BillingTier } from '@/domain/billing/tiers'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { Badge, Button, Card, Tabs, TabsList, TabsTrigger, Typography, cn } from '@cbrl/design'
import { Check, Clock } from 'lucide-react'
import { useState } from 'react'

// Pricing canônico — modelo de receita em [[Produto/PRD-Monetizacao-SaaS]].
// Cobrança por unidade dentro de cada Negócio, modelo base + marginal (1ª unidade
// no preço-base, unidade extra com desconto de escala, sem teto). Anual = 2 meses
// grátis (~17% off), exibido como preço/mês cobrado anualmente via o toggle.
//
// A IDENTIDADE dos tiers (slug, ordem, capabilities) é a fonte única do domínio
// (`@/domain/billing`); este componente carrega só a COPY de marketing e os
// preços de exibição, amarrados ao slug do domínio via `tier`. Isso impede que
// a página prometa o que o enforcement não libera (brief 0070, AC-03).
type BillingCycle = 'monthly' | 'annual'

type TierPrice = {
  // Preço por ciclo. `null` = plano gratuito (sem variação mensal/anual).
  priceLabel: string
  priceSuffix?: string
  priceNote?: string
}

type Tier = {
  // Slug do domínio (`@/domain/billing`) para os tiers cobráveis; `undefined`
  // só no tier de contato "Escala" (sem billing). Amarra a copy à fonte única.
  tier?: BillingTier
  name: string
  pricing: Record<BillingCycle, TierPrice>
  description: string
  cta: string
  highlighted?: boolean
  features: readonly string[]
  // Recursos no roadmap deste tier — exibidos com selo "Em breve" e NUNCA
  // misturados com os ativos. Honestidade de packaging: cobramos só o que já
  // está navegável; o futuro é ancorado, não vendido como pronto.
  comingSoon?: readonly string[]
  // Tier de contato comercial (ex.: "Escala"): sem preço público nem checkout.
  // O CTA leva a um canal externo (WhatsApp) em vez de `/login`, e o card é
  // sempre visível, independente de auth. Não lista features inexistentes —
  // só atendimento dedicado e preço sob medida.
  contactHref?: string
}

// Preço zero explícito (R$ 0), não a palavra "Grátis": o número casa com a
// hierarquia visual dos tiers pagos (mesmo tamanho de fonte, mesmo sufixo /mês)
// e comunica "sem custo" de forma mais chamativa — padrão do Notion (US$ 0). O
// "grátis para sempre" desce pra nota de apoio.
const FREE_PRICE: TierPrice = {
  priceLabel: 'R$ 0',
  priceSuffix: '/mês',
  priceNote: 'Grátis para sempre, 1 unidade.',
}

// Preço "sob consulta" reutilizado nos dois ciclos do tier de contato — não há
// valor público; o cliente fala com a gente.
const CONTACT_PRICE: TierPrice = { priceLabel: 'Sob medida' }

// Número comercial do cbrl (E.164, só dígitos) para o tier de contato "Escala".
const SALES_WHATSAPP = '5592984896424'

const TIERS: readonly Tier[] = [
  {
    tier: 'free',
    name: 'Grátis',
    pricing: { monthly: FREE_PRICE, annual: FREE_PRICE },
    description: 'Para começar a organizar a agenda do seu negócio.',
    cta: 'Começar grátis',
    features: [
      'Agenda, bloqueios e atendimentos',
      'Comanda e fechamento de venda',
      'Caixa e cadastros (clientes, serviços, equipe)',
      'Agendamento online pelo cliente',
      '1 unidade e equipe de até 2 (você + 1)',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    pricing: {
      monthly: {
        priceLabel: 'R$ 89',
        priceSuffix: '/mês por unidade',
        priceNote: 'Unidade extra a partir de R$ 59/mês',
      },
      annual: {
        priceLabel: 'R$ 74',
        priceSuffix: '/mês por unidade',
        priceNote: 'Cobrado anualmente · unidade extra a partir de R$ 49/mês',
      },
    },
    description: 'Para quem quer transformar clientes em receita recorrente.',
    cta: 'Assinar o Pro',
    highlighted: true,
    features: [
      'Tudo do Grátis, e mais:',
      'Planos e assinaturas (recorrência)',
      'Comissão por membro da equipe e repasse',
      'Copiloto: meta mensal de lucro',
      'Relatórios de vendas e comissões',
      'Unidades e equipe ilimitadas',
    ],
  },
  {
    tier: 'advanced',
    name: 'Avançado',
    pricing: {
      monthly: {
        priceLabel: 'R$ 149',
        priceSuffix: '/mês por unidade',
        priceNote: 'Unidade extra a partir de R$ 99/mês',
      },
      annual: {
        priceLabel: 'R$ 124',
        priceSuffix: '/mês por unidade',
        priceNote: 'Cobrado anualmente · unidade extra a partir de R$ 82/mês',
      },
    },
    description: 'Para quem quer cobrança e repasse no automático e suporte na frente.',
    cta: 'Assinar o Avançado',
    features: ['Tudo do Pro, e mais:', 'Suporte prioritário'],
    comingSoon: [
      'Cobrança recorrente automática',
      'Divisão automática do pagamento',
      'Conciliação de caixa e recebimentos',
      'Relatórios consolidados de várias unidades',
    ],
  },
  {
    name: 'Escala',
    pricing: { monthly: CONTACT_PRICE, annual: CONTACT_PRICE },
    description: 'Mais de 5 unidades ou precisa de algo sob medida? Vamos conversar.',
    cta: 'Falar com a gente',
    contactHref: `https://wa.me/${SALES_WHATSAPP}`,
    features: [
      'Atendimento e implantação dedicados',
      'Preço sob medida por volume',
      'Condições comerciais negociadas',
    ],
  },
] as const

// Drift guard (brief 0070, AC-03): every chargeable tier in the domain has
// exactly one card here, and no card claims a tier the domain doesn't know.
// Packaging (this component) and enforcement (`@/domain/billing`) can't diverge.
export const CHARGEABLE_TIER_SLUGS: readonly BillingTier[] = TIERS.flatMap((t) =>
  t.tier ? [t.tier] : [],
)

export function tiersMatchDomain(): boolean {
  const fromUi = [...CHARGEABLE_TIER_SLUGS].sort()
  const fromDomain = [...BILLING_TIERS].sort()
  return fromUi.length === fromDomain.length && fromUi.every((slug, i) => slug === fromDomain[i])
}

// Destination for a tier card's CTA. The /pricing page redirects authed users to
// /dashboard, so every visitor here is logged out: the CTA goes to /login. For a
// chargeable tier it carries `next` (land on billing after auth) + `intent` (the
// tier the visitor picked) so the post-login flow can offer that plan directly.
// Free just lands the visitor in the app.
function ctaHref(tier?: BillingTier): string {
  if (!tier || tier === 'free') return '/login'
  const next = encodeURIComponent('/billing')
  return `/login?next=${next}&intent=${tier}`
}

export function PricingTiers() {
  const authEnabled = isFirebaseConfigured()
  // Anual como padrão: mostra o preço mais atrativo primeiro e puxa pro plano
  // de maior retenção (2 meses grátis). O cliente alterna pro mensal se quiser.
  const [cycle, setCycle] = useState<BillingCycle>('annual')

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2">
        <Tabs
          value={cycle}
          onValueChange={(value) => {
            if (value === 'monthly' || value === 'annual') setCycle(value)
          }}
        >
          <TabsList>
            <TabsTrigger value="monthly">Mensal</TabsTrigger>
            <TabsTrigger value="annual">
              Anual
              <Badge variant="secondary" className="ml-2">
                2 meses grátis
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Alinhamento entre cards da mesma fileira via CSS subgrid: o grid externo
          define 4 linhas (cabeçalho · preço · CTA · features) e cada card herda
          esses tracks com `grid-rows-subgrid`. Assim o bloco de preço tem a MESMA
          altura em todos os cards da fileira — a nota anual que quebra em 2 linhas
          num card estica a linha inteira, e os vizinhos acompanham. Isso mata os
          dois bugs de uma vez: (1) nada desalinha entre cards, e (2) alternar
          mensal↔anual cresce a fileira junta, sem flick. Sem `min-h`/`h` chutado —
          a altura é a real, medida pelo layout. `items-stretch` (default do grid)
          garante que cada card preencha a altura da fileira. */}
      <div className="grid gap-6 md:grid-cols-2 md:grid-rows-[auto_auto_auto_1fr] lg:grid-cols-4">
        {TIERS.map((tier) => {
          const price = tier.pricing[cycle]
          return (
            <Card
              key={tier.name}
              className={cn(
                'gap-0 py-0 md:row-span-4 md:grid md:grid-rows-subgrid',
                tier.highlighted && 'border-foreground/30 ring-foreground/10 shadow-md ring-1',
              )}
            >
              <div className="flex flex-col gap-3 px-6 pt-6">
                <div className="flex h-6 items-center gap-2">
                  <Typography variant="large">{tier.name}</Typography>
                  {tier.highlighted && <Badge>Recomendado</Badge>}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1">
                  <Typography as="span" variant="h1" className="text-4xl">
                    {price.priceLabel}
                  </Typography>
                  {price.priceSuffix && (
                    <Typography as="span" variant="muted" className="text-sm">
                      {price.priceSuffix}
                    </Typography>
                  )}
                </div>
                {price.priceNote && (
                  <Typography as="span" variant="muted" className="text-xs text-pretty">
                    {price.priceNote}
                  </Typography>
                )}
              </div>

              <div className="px-6 pt-3">
                <Typography variant="muted" className="text-sm text-balance">
                  {tier.description}
                </Typography>
              </div>

              <div className="px-6 pt-4">
                {tier.contactHref ? (
                  <Button asChild variant="outline" className="w-full">
                    <a href={tier.contactHref} target="_blank" rel="noreferrer">
                      {tier.cta}
                    </a>
                  </Button>
                ) : (
                  authEnabled && (
                    <Button
                      asChild
                      variant={tier.highlighted ? 'default' : 'outline'}
                      className="w-full"
                    >
                      <a href={ctaHref(tier.tier)}>{tier.cta}</a>
                    </Button>
                  )
                )}
              </div>

              <div className="flex flex-col gap-3 px-6 pt-6 pb-6">
                <ul className="flex flex-col gap-3 border-t pt-6">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check
                        aria-hidden
                        className="text-foreground/70 mt-0.5 size-4 shrink-0"
                        strokeWidth={2.5}
                      />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.comingSoon && (
                  <ul className="flex flex-col gap-3">
                    {tier.comingSoon.map((feature) => (
                      <li
                        key={feature}
                        className="text-muted-foreground/70 flex items-start gap-2 text-sm"
                      >
                        <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {feature}
                          <span className="text-muted-foreground/50 ml-1.5 text-xs">Em breve</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

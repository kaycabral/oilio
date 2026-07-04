import { Badge, Typography } from '@cbrl/design'
import { KeyRound } from 'lucide-react'

// Callout de venda do multi-negócio na /pricing: reforça, no momento da decisão
// de plano, que gerenciar vários negócios num login está incluso em QUALQUER
// plano (até o Grátis). Versão compacta do palco que a landing dá ao tema
// (LandingMultiBusiness); o ângulo é "vem de graça". Distinto de multi-unidade
// (filiais do mesmo negócio). Copy fala só da gente — sem comparar com o mercado.
export function PricingMultiBusiness() {
  return (
    <section className="border-border flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center">
      <div className="flex items-center gap-2">
        <KeyRound aria-hidden className="text-foreground/70 size-5" strokeWidth={2} />
        <Badge variant="secondary" className="uppercase">
          Incluso em todo plano
        </Badge>
      </div>
      <Typography as="h2" variant="h3" className="border-none pb-0">
        Tem mais de um negócio? Gerencie todos num login
      </Typography>
      <Typography variant="muted" className="max-w-prose text-base">
        Uma barbearia e um lava-rápido na mesma conta, cada um com o seu plano — um pode ser Grátis
        e o outro Pro. Você alterna num clique, sem outra assinatura.
      </Typography>
    </section>
  )
}

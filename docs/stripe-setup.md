# Configuração do Stripe — Assinatura Oilio

Este guia descreve como provisionar os Products/Prices do Stripe que sustentam a
**Assinatura Oilio** (cobrança SaaS lojista → Oilio) e como conectar as chaves ao
app. A modelagem de produto é canônica na Wiki em `Produto/PRD-Monetizacao-SaaS`;
aqui mora só o passo-a-passo operacional.

## Modelo de cobrança

A cobrança é **por unidade, graduated** (escalonada): a 1ª unidade de cada Negócio
custa o preço-base e cada unidade extra entra com desconto de escala, sem teto. O
Stripe calcula o total a partir do `quantity` (= número de unidades ativas no
Negócio); o app nunca soma preço manualmente — só envia o `quantity` e deixa o
Price graduated resolver o valor.

São quatro Prices, um por tier cobrável × ciclo:

| Tier     | Ciclo  | 1ª unidade  | Unidade extra | Env var                         |
| -------- | ------ | ----------- | ------------- | ------------------------------- |
| Pro      | mensal | R$ 89/mês   | R$ 59/mês     | `STRIPE_PRICE_PRO_MONTHLY`      |
| Pro      | anual  | R$ 74/mês¹  | R$ 49/mês¹    | `STRIPE_PRICE_PRO_ANNUAL`       |
| Avançado | mensal | R$ 149/mês  | R$ 99/mês     | `STRIPE_PRICE_ADVANCED_MONTHLY` |
| Avançado | anual  | R$ 124/mês¹ | R$ 82/mês¹    | `STRIPE_PRICE_ADVANCED_ANNUAL`  |

¹ O ciclo anual é "2 meses grátis" (~17% off). No Stripe, o Price anual é cobrado
de uma vez por ano; os valores acima são a visão **por mês** que a `/pricing`
exibe. Ao criar o Price anual, multiplique por 10 (12 meses − 2 grátis) para o
valor anual de fato.

O tier **Free** não tem Price nem objeto no Stripe (1 unidade grátis, sem
checkout). O tier **Rede** é contato comercial (WhatsApp), também fora do Stripe.

## Criar os Products e Prices graduated

Cada Price graduated tem dois tiers de quantidade: o 1º range (`up_to: 1`) com o
preço-base e o 2º range (`up_to: inf`) com o preço da unidade extra, ambos no
modo `graduated`.

Pela Stripe CLI (exemplo do Pro mensal — repita para os outros três, ajustando
nome, valores e intervalo):

```sh
# 1) Product
stripe products create \
  --name "Oilio Pro" \
  --description "Assinatura Oilio — plano Pro (cobrança por unidade)"

# 2) Price graduated mensal (valores em centavos: R$89 = 8900, R$59 = 5900)
stripe prices create \
  --product prod_XXXX \
  --currency brl \
  --recurring.interval month \
  --billing-scheme tiered \
  --tiers-mode graduated \
  -d "tiers[0][up_to]=1" \
  -d "tiers[0][unit_amount]=8900" \
  -d "tiers[1][up_to]=inf" \
  -d "tiers[1][unit_amount]=5900"
```

Para o ciclo anual, use `--recurring.interval year` e o valor anual (mensal × 10).

O dashboard (Product catalog → Add product → Recurring → Tiered / Graduated)
faz o mesmo de forma visual; o resultado é idêntico — o que importa é capturar o
`price_...` de cada um.

## Conectar ao app

As chaves e price ids são lidos por `@cbrl/env` (`requireEnv`, fail-fast — sem
fallback literal). Preencha no `.env.local` (test mode) e, em produção, no secret
manager do ambiente:

```sh
STRIPE_SECRET_KEY=rk_test_...          # prefira uma restricted API key (rk_) à secret (sk_)
STRIPE_WEBHOOK_SECRET=whsec_...        # ver "Webhook local" abaixo
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_ADVANCED_MONTHLY=price_...
STRIPE_PRICE_ADVANCED_ANNUAL=price_...
```

> Não tem conta? `stripe sandbox create` gera chaves de teste funcionais sem
> cadastro. Use sempre a última versão da API/SDK.
>
> A versão da API é fixada **num único lugar**: a constante `STRIPE_API_VERSION`
> em `src/shared/billing/stripe-api-version.ts`. Client do app, scripts
> (`sync-stripe-catalog`, seed) e testes importam dela. A constante é tipada
> contra o SDK (`satisfies Stripe.LatestApiVersion`): ao subir o pacote `stripe`
> para uma versão que pina outra API, o typecheck falha só nessa linha — trocar
> o literal ali é a mudança revisada de upgrade (leia o changelog da API entre
> as duas versões antes).
>
> Os eventos do webhook chegam na versão de API do **endpoint** cadastrado no
> Stripe, não na do SDK. A cada troca de `STRIPE_API_VERSION`, crie/atualize o
> endpoint de webhook de produção (e o de teste) para a mesma versão (#2).

## Webhook local

O webhook (`/api/webhooks/stripe`, brief 0074) reconcilia o estado da assinatura.
Em desenvolvimento, encaminhe os eventos para a porta 3005 do dev server:

```sh
stripe listen --forward-to localhost:3005/api/webhooks/stripe
```

O comando imprime um `whsec_...` — copie para `STRIPE_WEBHOOK_SECRET` no
`.env.local`. Para disparar eventos de teste:

```sh
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

## Testes automatizados

O E2E não fala com o Stripe de verdade: roda contra o `stripe-mock` oficial,
que valida os requests contra o OpenAPI do Stripe e devolve fixtures. Detalhes
em [`docs/e2e-conventions.md`](e2e-conventions.md) § Setup. A env
`STRIPE_API_BASE` é exclusiva do E2E — não configure em nenhum ambiente real.

## Smoke do fluxo completo

1. Suba o dev server na 3005 e o `stripe listen` (acima).
2. Em um Negócio Free, abra **Plano e cobrança** (`/settings/billing`) e assine o
   Pro. No checkout, use o cartão de teste `4242 4242 4242 4242`.
3. Confirme que o webhook ativou a assinatura: o painel passa a mostrar Pro,
   ciclo e próxima cobrança, e as features gated (planos, comissões, copiloto,
   relatórios) destravam.
4. Crie uma 2ª unidade e confirme que o `quantity` da subscription sobe (cobrança
   proporcional no meio do ciclo, `proration_behavior: create_prorations`).
5. Cancele pelo portal e confirme que o acesso permanece até o fim do ciclo
   (`cancel_at_period_end`).

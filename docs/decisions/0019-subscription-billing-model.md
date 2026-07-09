# ADR 0019 — Modelo de Cobrança de Assinatura (Timing, Ativação e Simplificação de Estados)

- **Status**: accepted
- **Date**: 2026-07-09
- **Deciders**: kaycabral
- **Related ADRs**: [0016-revenue-recognition-competencia](0016-revenue-recognition-competencia.md) (alinhamento de regime de competência de receita com cobrança pré-paga)

## Context

Ao refinar a modelagem de recorrência do Oilio (Feature `0003-cobranca-recorrente`), o fluxo original permitia que uma assinatura (`Subscription`) fosse criada no estado `pending` sem uma cobrança liquidada correspondente, transicionando para `active` somente após um evento posterior de `subscription.charge_settled`. 

Esse desenho introduzia complexidade e riscos operacionais significativos:
1. **Brechas de Receita Fantasma**: Possibilidade de cancelamento de uma assinatura ainda não cobrada (`pending` -> `cancelled`), gerando inconsistências no Razão financeiro e DRE (lançamentos de competência órfãos de liquidação real).
2. **Complexidade no Reducer e Projeções**: Manutenção de estados temporários como `pending` e `suspended` que não possuíam regras claras de negócio ou produtores consistentes (estados fantasmas).
3. **Desalinhamento com Gateways Modernos**: Gateways de pagamento de referência (como Stripe) tratam a ativação da assinatura como intrinsecamente atrelada ao sucesso da primeira fatura (invoice paid).

Para consolidar as regras fiscais e de domínio antes da automação via gateway entrar em produção, precisamos definir de forma canônica o comportamento de timing de cobrança, obrigatoriedade de pagamento e ciclo de vida de status.

## Decision

Adotamos as seguintes regras para a cobrança e ciclo de vida de assinaturas do Oilio:

1. **Momento da Cobrança (Pré-pago)**: A cobrança de assinaturas ocorre estritamente no início do ciclo de faturamento (modelo pré-pago). O cliente paga para consumir o período correspondente. Não há suporte a cobrança pós-paga.
2. **Pagamento Obrigatório na Entrada (Pay-on-entry)**: Nenhuma assinatura é considerada ativa (`active`) sem que o primeiro pagamento correspondente tenha sido liquidado. A criação da assinatura (`subscription.created`) e a liquidação do primeiro pagamento (`subscription.charge_settled`) ocorrem na mesma transação atômica (`ACID tx`), garantindo que a assinatura já nasça ativa com uma cobrança liquidada.
3. **Simplificação da Máquina de Estados**:
   - O estado `pending` é completamente **removido** do domínio (`SubscriptionStatus`), reducer, projeções e telas.
   - O estado `suspended` (antigo estado sem produtor) é **removido**.
   - Os 4 status válidos e canônicos de assinatura passam a ser:
     - `active`: Assinatura com ciclo corrente pago e ativa.
     - `past_due`: Assinatura em processo de recuperação/cobrança pendente após falha na renovação.
     - `cancelled`: Assinatura cancelada (seja por solicitação ou fim de vigência).
     - `cancelled_for_non_payment`: Assinatura cancelada definitivamente por inadimplência sistemática.
4. **Ausência de Trial no Domínio**: Não modelamos o estado `trial` na máquina de estados principal. Caso uma estratégia de trial seja adotada futuramente, ela será modelada:
   - Através de um plano promocional com preço R$ 0 nos primeiros N dias, mantendo a assinatura logicamente `active` mas sem cobrança de valor; ou
   - Gerenciada exclusivamente na camada do gateway de pagamento, mantendo o domínio de negócio do Oilio limpo.
5. **Prevenção de Cancelamento sem Cobrança**: Por construção (item 2), não existe brecha para cancelamento de assinaturas não pagas. Uma assinatura cancelada mid-cycle pelo cliente transiciona para `cancelAtPeriodEnd: true` (continua utilizável e ativa até o final do período pago) e vira `cancelled` apenas no término do período. Em caso de inadimplência, transiciona para `cancelled_for_non_payment` após a falha da última tentativa de re-cobrança.

## Consequences

- **Positivo**: Simplificação expressiva do reducer e das regras de transição de estado da assinatura.
- **Positivo**: Eliminação completa de receita fantasma no Razão (toda competência de assinatura ativa é respaldada por uma cobrança liquidada real).
- **Positivo**: Alinhamento robusto com os fluxos do Stripe/Pagar.me de ativação imediata no sucesso da invoice.
- **Custo**: Fluxos de assinatura manuais/offline precisam simular ou registrar a entrada de pagamento no ato da criação para que o sistema registre a assinatura.
- **Aberto**: A retry policy do gateway (número de tentativas antes do cancelamento definitivo) fica estabelecida em 3 tentativas falhas para mover para `cancelled_for_non_payment`.

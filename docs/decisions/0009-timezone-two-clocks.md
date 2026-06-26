# ADR 0009 — Timezone: dois relógios (operacional vs liquidação)

- **Status**: accepted
- **Date**: 2026-05-31
- **Deciders**: kaycabral
- **Brief**: [`0015-caixa-financeiro-v0`](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0015-caixa-financeiro-v0) § Princípio — dois relógios
- **Parent issue**: [#993](https://gitlab.com/cbrl/cbrl/-/issues/993) · **Task**: [#996](https://gitlab.com/cbrl/cbrl/-/issues/996)
- **Supersedes**: nenhum
- **Related ADRs**: [0004-multi-org-model](0004-multi-org-model.md), [0007-payment-gateway-interface](0007-payment-gateway-interface.md), [0008-event-sourcing-ddd-effect](0008-event-sourcing-ddd-effect.md)

## Context

Tempo aparece em duas naturezas distintas no produto, e misturá-las gera bug (e desconfia o lojista). A agenda já fixou o invariante operacional (storage UTC / display no fuso da unidade — ver [`docs/timezone.md`](../timezone.md)), mas faltava um padrão **canônico cross-cutting** que valesse pra agenda, comanda, caixa e — no futuro — conciliação/repasse, pra que cada brief vizinho não re-decidisse fuso do zero.

O gatilho foi o caixa por período ([0015](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0015-caixa-financeiro-v0)): "o dia do relatório é em que fuso?". A resposta exige separar o relógio que o lojista enxerga do relógio que rege a liquidação financeira — que **não é nosso**.

Uma crença comum precisava ser checada antes de virar regra: a de que cartões "fecham às 23h59 / aceitam ordens até 22h" em Horário de Brasília. Deep-research (2026-05-30) **não confirmou** esses números em fonte oficial.

## Decision

O produto opera em **dois relógios que nunca se misturam**.

### Relógio 1 — Operacional (agenda, comanda, caixa)

Sempre o **fuso local da unidade**, transparente ao usuário: o lojista nunca vê "Brasília" nem configura fuso.

- **Implementação** já canônica em [`docs/timezone.md`](../timezone.md): storage sempre UTC (ISO), display sempre convertido pra `org.timezone` (IANA); helpers em `@/domain/utils/timezone`; proibido `getHours()`/`getUTCHours()` direto.
- Janelas de "dia" (ex.: relatório de caixa por período — [0015](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0015-caixa-financeiro-v0) AC-05) usam o **"hoje" local da unidade** via `getOrgDayBoundsUtc`. O corte de Brasília/SPB **não** se aplica aqui.

### Relógio 2 — Liquidação / repasse

Regida pela grade do SPB em **Horário de Brasília + dia útil** (Res. BCB nº 105/2021; liquidação de cartões via Núclea/SLC) — **mas é domínio do gateway/adquirente, não do app**.

- O app **consome** a data de repasse que o adquirente informa; **nunca calcula** o corte de Brasília nem o dia útil de liquidação.
- A conciliação caixa ↔ gateway ([0005-conciliacao-caixa](https://gitlab.com/cbrl/cbrl/-/wikis/Funcionalidades/0005-conciliacao-caixa), futuro) concilia **período local × repasses informados**, sem recriar a regra do SPB.

### Regra de ouro

Se o usuário vê → relógio da unidade. Se o dinheiro liquida → relógio do gateway (consumido, não calculado). Nenhum código de produto calcula corte de liquidação.

## Consequences

- **Positivas**: um padrão único referenciável pelos briefs vizinhos (0008/0009/0013/0021/0005) — fim do re-decidir fuso por feature. O caixa por período fica com semântica clara ("hoje" do lojista). Zero acoplamento a regra de liquidação que não controlamos (e que muda por adquirente).
- **Custos / limitações**: per-unit timezone editável via UI segue fora do V0 (ver `docs/timezone.md` § Limitações / #719). Quando a conciliação (0005) entrar, depende da data de repasse vir estruturada do adquirente — risco delegado ao gateway por decisão consciente.
- **Anti-padrão proibido**: hardcodar "23h59"/"22h"/"Brasília" em qualquer cálculo de corte de vendas ou liquidação. Não existe em fonte oficial; é decisão de cada adquirente.

## Sources

- **Deep-research 2026-05-30** (decisão de produto, Kayron): a crença "fechamento às 23h59 / ordens até 22h" em Horário de Brasília **não se confirma** em fonte oficial — esses números não existem na liquidação do SPB; o corte de vendas é decisão de cada adquirente e a SumUp sequer declara fuso. InfinitePay (fonte primária) exibe o relatório do lojista em **horário local**.
- **Res. BCB nº 105/2021** — grade de liquidação do SPB (Horário de Brasília + dia útil).
- **Núclea / SLC** — câmara de liquidação de cartões.
- [`docs/timezone.md`](../timezone.md) — implementação do relógio operacional (storage UTC / display org tz).

# ADR 0018 — Zero comentários no código (o código é a fonte única; doc oficial é ADR + Wiki)

- **Status**: accepted
- **Date**: 2026-07-08
- **Deciders**: kaycabral
- **Related ADRs**: [0017-oilio-em-producao](0017-oilio-em-producao.md) (a regra anti-premissa-stale que motivou esta: comentário-fato envelhece e engana; esta ADR elimina a classe inteira) · [0015-canonical-error-contract](0015-canonical-error-contract.md) (invariantes load-bearing vivem em código/teste, não em prosa)

## Context

A auditoria #1383 provou o custo concreto de informação declarativa desatualizada: um comentário afirmando "oilio is pre-prod" quase induziu a corromper o event store de produção. O comentário é uma **segunda fonte de verdade paralela ao código** que pode divergir dele silenciosamente — e diverge, porque nada obriga a mantê-los em sincronia.

O problema não é um comentário específico; é a categoria. Comentário que explica **o quê** duplica o código (que já diz o quê). Comentário que explica **por quê** de forma load-bearing é conhecimento crítico guardado num lugar que o compilador não verifica e que ninguém é forçado a atualizar. Ambos são débito: o primeiro é ruído, o segundo é uma armadilha.

A doc oficial do produto já tem lar canônico: **ADR** (decisão arquitetural) e **Wiki** (produto/feature/brief). Comentário no código nunca foi doc oficial — é uma terceira camada informal que compete com as duas canônicas.

## Decision

**O código-fonte do oilio não carrega comentários.** A única fonte de verdade sobre o comportamento é o próprio código; a única doc oficial é **ADR + Wiki**.

Um "comentário" só sobrevive se tem **serventia funcional para uma ferramenta/lib/framework** — isto é, se algo além de um humano o consome:

- **Pragmas de máquina**: `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `@ts-check`, `/// <reference>`, `/// <amd-*>`, `/* global */`, `/* eslint-env */`, `prettier-ignore`, `c8`/`v8`/`istanbul ignore`, `@jest-environment`/`@vitest-environment`, shebang. O TS/ESLint/prettier/coverage runner os consomem.
- **TSDoc anexado a uma declaração E com ao menos uma `@tag`**: o compilador TS anexa o bloco `/** */` à declaração, e o IntelliSense/TypeDoc o consomem. Exige `@tag` (`@param`/`@returns`/`@remarks`/`@deprecated`/…) para não virar brecha de prosa dentro de `/** */`.

Tudo o mais — `//`, `/* */`, `{/* */}` em JSX, e `/** */` solto ou sem tag — é **proibido** e removido.

### Enforcement

Regra ESLint custom **`cbrl/no-non-doc-comments`** (em `@cbrl/eslint-config`), ligada como **`error`** em `apps/web/src/**` e `tests/**`. O determinismo é do **compilador**: a decisão "isto é TSDoc" consulta `parserServices.program` (o mesmo TS que compila o código anexou o bloco?), não regex de texto — então a regra nunca diverge do que o build entende. É `fixable`: `eslint --fix` remove os comentários proibidos (incluindo o container `{}` de JSX comments).

Escopo: **oilio apenas**. Os outros apps do monorepo não estão sob a regra e mantêm seus comentários até serem trabalhados individualmente — a regra não impacta o CI deles.

### Consequência operacional para agentes (Claude Code)

Nenhuma decisão de engenharia se apoia em comentário do código (não há). Para entender **por que** algo é como é, o agente **investiga o código, o uso e os testes** — e, quando é decisão de produto/arquitetura, lê **ADR/Wiki**. Não existe "o comentário disse que…"; existe o que o código faz e o que a doc oficial decidiu.

## Consequences

- **Positivo**: elimina a classe de bug da #1383 (fonte paralela que envelhece); o código é forçado a ser auto-explicativo (nomes, extração, tipos); a doc oficial deixa de competir com prosa informal; um invariante que era comentário-porquê é forçado a virar **nome, estrutura, teste ou ADR** — lugares que ou o compilador ou o CI verificam.
- **Custo**: conhecimento que vivia só num comentário-porquê e não foi convertido **se perde** na remoção em massa (decisão consciente: a conversão caso-a-caso é responsabilidade do code review, não da limpeza mecânica). Blocos que só continham um comentário (`catch {}`, branch `if {} else`) foram reescritos para expressar a intenção em código, não em prosa.
- **Aberto**: promover a regra aos demais apps do monorepo é trabalho por-app futuro; ligar `eslint --fix` no pre-commit (`lint-staged`) para manter o zero automaticamente é follow-up de harness.

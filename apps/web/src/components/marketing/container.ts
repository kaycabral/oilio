// Largura canônica das superfícies de marketing (landing, pricing, header,
// footer). Alinhada ao frame do app (`max-w-7xl` = 1280px, o mesmo do primitivo
// `Main` do design system — ver `packages/design/src/components/main.tsx`), pra
// a landing aproveitar o espaço em telas grandes em vez do antigo `max-w-5xl`
// (1024px), que era apertado pra uma página de marketing. A restrição de
// LARGURA DE TEXTO (headlines/leads legíveis) fica por conta de cada seção via
// `max-w-prose`/`max-w-2xl` — o container só governa o alinhamento externo.
//
// Ponto único: os três shells de marketing (header, main, footer) importam
// daqui pra a borda esquerda alinhar em todas as rotas e o valor não divergir.
export const MARKETING_CONTAINER = 'mx-auto w-full max-w-7xl px-6'

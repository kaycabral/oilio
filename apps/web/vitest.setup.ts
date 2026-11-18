import '@testing-library/jest-dom/vitest'

// jsdom não implementa as APIs de layout/observer que os primitivos Radix
// (Select, Checkbox, Switch…) usam. Polyfill uma vez aqui pra qualquer teste de
// componente conseguir renderizar e interagir com esses primitivos sem
// boilerplate por arquivo (mesmo padrão do @cbrl/design).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

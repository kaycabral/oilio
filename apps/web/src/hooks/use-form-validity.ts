'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Constraint-validation attributes: the ONLY attribute mutations that can change
// `form.checkValidity()`. Re-validating on any OTHER attribute change is both
// wasteful and a correctness bug — a sibling combobox toggling cosmetic attrs
// (`aria-expanded`, the search spinner's `class`) on a late debounced render
// would recompute the submit gate mid-submit and flicker the button to disabled
// (observed flake: product-autofill create hung 30s because Criar re-disabled
// after the click). Scoping the observer to these attrs decouples validity from
// cosmetic DOM churn while still catching `required`/`disabled`/value-bound
// changes on the actual fields.
const CONSTRAINT_ATTRS = [
  'value',
  'required',
  'disabled',
  'min',
  'max',
  'minlength',
  'maxlength',
  'pattern',
  'step',
  'type',
  'checked',
]

/**
 * Form-level validity tracking via `HTMLFormElement.checkValidity()`. Use o
 * ref retornado no <form> e o `isValid` pra desabilitar o submit. O hook
 * observa mutações no DOM (campos aparecendo/sumindo via render condicional,
 * via `childList`/`subtree`) além de eventos de input/change, então funciona pra
 * forms dinâmicos como o `AddressFields` (lookup do CEP adiciona inputs). Mutações
 * de atributo são filtradas pras que afetam constraint validation
 * ({@link CONSTRAINT_ATTRS}) — atributo cosmético (ex.: `aria-expanded` de um
 * combobox) não re-dispara validação.
 */
export function useFormValidity<T extends HTMLFormElement = HTMLFormElement>(): {
  formRef: React.RefObject<T | null>
  isValid: boolean
  /**
   * Human label of the FIRST invalid field, so a disabled submit can tell the
   * user WHICH field is still pending — critical when the culprit is revealed by
   * progressive disclosure (e.g. the address `Número` that only appears after the
   * CEP lookup) and may be off-screen (#1296). `null` when the form is valid.
   * Derived from the field's associated `<label>` text, falling back to its
   * accessible name (`aria-label`) or `name` attribute.
   */
  firstInvalidLabel: string | null
  refresh: () => void
} {
  const formRef = useRef<T | null>(null)
  const [isValid, setIsValid] = useState(false)
  const [firstInvalidLabel, setFirstInvalidLabel] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const form = formRef.current
    setIsValid(form?.checkValidity() ?? false)
    setFirstInvalidLabel(form ? firstInvalidFieldLabel(form) : null)
  }, [])

  useEffect(() => {
    refresh()
    const form = formRef.current
    if (!form) return
    const observer = new MutationObserver(refresh)
    observer.observe(form, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: CONSTRAINT_ATTRS,
    })
    return () => observer.disconnect()
  }, [refresh])

  return { formRef, isValid, firstInvalidLabel, refresh }
}

// The human label of the first constraint-invalid control in the form, in DOM
// order (matches the order the browser would focus on submit). Prefers the
// associated `<label>` text (`labels[0]`), then the accessible name (`aria-label`),
// then the `name` attribute — never the raw value. `null` when everything is valid.
function firstInvalidFieldLabel(form: HTMLFormElement): string | null {
  for (const el of Array.from(form.elements)) {
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      )
    ) {
      continue
    }
    if (el.willValidate && !el.checkValidity()) {
      const labelText = el.labels?.[0]?.textContent?.trim()
      if (labelText) return labelText
      const ariaLabel = el.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel
      return el.name || null
    }
  }
  return null
}

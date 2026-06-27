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
  refresh: () => void
} {
  const formRef = useRef<T | null>(null)
  const [isValid, setIsValid] = useState(false)

  const refresh = useCallback(() => {
    setIsValid(formRef.current?.checkValidity() ?? false)
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

  return { formRef, isValid, refresh }
}

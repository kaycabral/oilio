'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Form-level validity tracking via `HTMLFormElement.checkValidity()`. Use o
 * ref retornado no <form> e o `isValid` pra desabilitar o submit. O hook
 * observa mutações no DOM (campos aparecendo/sumindo via render condicional)
 * além de eventos de input/change, então funciona pra forms dinâmicos como o
 * `AddressFields` (lookup do CEP adiciona inputs).
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
    observer.observe(form, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [refresh])

  return { formRef, isValid, refresh }
}

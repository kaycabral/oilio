'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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

export function useFormValidity<T extends HTMLFormElement = HTMLFormElement>(): {
  formRef: React.RefObject<T | null>
  isValid: boolean
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

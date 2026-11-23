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
  'hidden',
]

export function useStepValidity<T extends HTMLElement = HTMLElement>(): {
  panelRef: React.RefObject<T | null>
  isValid: boolean
  firstInvalidLabel: string | null
  refresh: () => void
} {
  const panelRef = useRef<T | null>(null)
  const [isValid, setIsValid] = useState(false)
  const [firstInvalidLabel, setFirstInvalidLabel] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const panel = panelRef.current
    if (!panel) {
      setIsValid(false)
      setFirstInvalidLabel(null)
      return
    }
    const invalid = firstInvalidField(panel)
    setIsValid(invalid === null)
    setFirstInvalidLabel(invalid ? fieldLabel(invalid) : null)
  }, [])

  useEffect(() => {
    refresh()
    const panel = panelRef.current
    if (!panel) return
    const observer = new MutationObserver(refresh)
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: CONSTRAINT_ATTRS,
    })
    return () => observer.disconnect()
  }, [refresh])

  return { panelRef, isValid, firstInvalidLabel, refresh }
}

type ConstraintField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function firstInvalidField(panel: HTMLElement): ConstraintField | null {
  const fields = panel.querySelectorAll<ConstraintField>('input, select, textarea')
  for (const el of Array.from(fields)) {
    if (el.willValidate && !el.checkValidity()) return el
  }
  return null
}

function fieldLabel(el: ConstraintField): string | null {
  const labelText = el.labels?.[0]?.textContent?.replace(/\*\s*$/, '').trim()
  if (labelText) return labelText
  const ariaLabel = el.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  return el.name || null
}

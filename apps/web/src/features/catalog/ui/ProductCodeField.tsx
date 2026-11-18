'use client'

import {
  codeNotice,
  normalizeCodeInput,
  type CodeFormState,
} from '@/features/catalog/core/catalog-item-form'
import { Input, Label } from '@oilio/design'

export function ProductCodeField({
  defaultValue,
  state,
  pending,
  onLookup,
  onCleared,
}: {
  defaultValue: string
  state: CodeFormState
  pending: boolean
  onLookup: (code: string) => void
  onCleared: () => void
}) {
  const nameFilled = state.kind === 'filled' && state.source === 'name'
  function commit(raw: string): void {
    const code = normalizeCodeInput(raw)
    if (code === '') {
      onCleared()
      return
    }
    onLookup(code)
  }

  const notice = codeNotice(state)

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="catalog-code" className="text-sm font-medium">
        Código do produto
      </Label>
      <Input
        id="catalog-code"
        name="gtin"
        defaultValue={defaultValue}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Passe o leitor ou digite o código"
        disabled={pending || nameFilled}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(e.currentTarget.value)
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onChange={(e) => {
          if (normalizeCodeInput(e.currentTarget.value) === '') onCleared()
        }}
      />
      {state.kind === 'filled' ? (
        <span className="text-muted-foreground text-xs">Veio preenchido da base ✓</span>
      ) : null}
      {notice ? <span className="text-muted-foreground text-xs">{notice}</span> : null}
    </div>
  )
}

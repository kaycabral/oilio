'use client'

import {
  codeNotice,
  normalizeCodeInput,
  type CodeFormState,
} from '@/features/catalog/core/catalog-item-form'
import { Input, Label } from '@cbrl/design'

// The product-code entry (brief 0054 § Grupo A). Human label, NO jargon — the
// user never sees GTIN/SKU/"barcode" (AC-04). A barcode reader acts as a keyboard
// (HID): it types the digits and presses Enter; we autosubmit the live lookup on
// Enter (AC-01) and on blur. Paste and manual typing go through the SAME
// normalization, so they behave identically to a scan (AC-05).
//
// The field's `name` is `gtin` because the save gate already reads
// `formString(formData, 'gtin')` — the wire contract is unchanged; only the boca
// (this input) is new.
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
  // Fired with the normalized code when the user commits (Enter or blur) a
  // non-empty value — the shell runs the live lookup.
  onLookup: (code: string) => void
  // Fired when the field becomes empty — the shell reverts the form (AC-06).
  onCleared: () => void
}) {
  // When the NAME boca filled the form (feature D), the reference key rides a
  // hidden `gtin` the form renders — so this input must NOT also submit a `gtin`
  // (two same-named fields → the save reads the wrong, empty one). A disabled
  // input is not submitted, so we drop this field's wire while name-filled. To
  // revert a name fill the user uses the name field's "Trocar produto" affordance
  // (which re-enables this input); the code box stays visible as context.
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
        // A scanner ends its "typing" with Enter; intercept it so the live
        // lookup fires instead of submitting the whole form (AC-01).
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(e.currentTarget.value)
          }
        }}
        // Manual typing / paste commit on blur too — same normalization (AC-05).
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

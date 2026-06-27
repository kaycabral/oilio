'use client'

import type { ProductSuggestion } from '@/features/catalog/core/catalog-item-form'
import { Input } from '@cbrl/design'
import { useEffect, useRef, useState } from 'react'

// The name combobox (brief 0055 § Grupo B, AC-01/AC-02). The `Nome` field of a
// new product: typing searches the sovereign base by name and suggests products
// other businesses contributed; choosing one fills + locks the intrinsics.
//
// Built as a plain input + an inline listbox (NOT a Radix Popover) on purpose: a
// Popover traps focus, which fights a typeahead — the input must keep focus while
// the list shows. The list is a sibling absolutely-positioned panel; selection is
// by click or keyboard (↑/↓/Enter/Esc). Strictly product language — never GTIN /
// SKU / "barcode" (AC-07); the user sees only product names + light disambiguation.
//
// The `<input name="name">` is the canonical field the form submits — a free-typed
// name registers manually exactly as before (AC-01: the manual flow is intact).
export function ProductNameCombobox({
  defaultName,
  required,
  suggestions,
  searching,
  onQuery,
  onSelect,
  onCleared,
  onDismiss,
}: {
  defaultName: string
  required: boolean
  suggestions: readonly ProductSuggestion[]
  searching: boolean
  // Fired with the current term as the user types (the shell debounces + searches).
  onQuery: (query: string) => void
  // Fired when the user chooses a suggestion (the shell fills + locks intrinsics).
  onSelect: (suggestion: ProductSuggestion) => void
  // Fired when the field is emptied — reverts any prior fill (AC-06).
  onCleared: () => void
  // Fired when the user dismisses the search (Escape / blur) WITHOUT picking a
  // suggestion: aborts a still-pending debounced search so it can't re-render the
  // form after the user moved on (the race that flaked submit/redirect). Keeps the
  // typed name — it only kills the search, not the field.
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(false)
  // Active descendant for keyboard nav: -1 = none highlighted.
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // A new async result can shrink (or replace) the list while a row is highlighted
  // — without resetting, `activeIndex` would point past the array (aria-activedescendant
  // dangling, Enter selecting `undefined`, ArrowDown jumping by a stale modulus). Reset
  // the highlight whenever the suggestions identity changes.
  useEffect(() => {
    setActiveIndex(-1)
  }, [suggestions])

  const showList = open && suggestions.length > 0
  const listboxId = 'catalog-name-listbox'

  function change(value: string): void {
    setOpen(true)
    setActiveIndex(-1)
    if (value.trim() === '') {
      onCleared()
      return
    }
    onQuery(value)
  }

  function choose(suggestion: ProductSuggestion): void {
    // Echo the chosen name into the input so the submitted `name` matches; the
    // shell locks it (this combobox unmounts, replaced by the read-only input).
    if (inputRef.current !== null) inputRef.current.value = suggestion.name
    setOpen(false)
    setActiveIndex(-1)
    onSelect(suggestion)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!showList) {
      // Re-open the list on ArrowDown if there are suggestions to show.
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault()
        setOpen(true)
        setActiveIndex(0)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % suggestions.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
        break
      case 'Enter': {
        // Choose the highlighted suggestion; if none is highlighted, let the
        // free-typed name stand (don't submit the form from here).
        const picked = suggestions[activeIndex]
        if (picked !== undefined) {
          e.preventDefault()
          choose(picked)
        }
        break
      }
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
        // Escape means "I'm done searching": also abort any pending debounced
        // search so it can't fire a late re-render after this point.
        onDismiss()
        break
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id="catalog-name"
        name="name"
        defaultValue={defaultName}
        required={required}
        minLength={2}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `catalog-name-option-${activeIndex}` : undefined}
        placeholder="Digite o nome do produto"
        onChange={(e) => change(e.currentTarget.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true)
        }}
        // Let a click on a suggestion land before the blur closes the list (the
        // 120ms lets `onMouseDown` on a row run first). Blurring away also ends an
        // unfinished search: if the user tabs/clicks out (e.g. onto "Criar") a
        // debounced query scheduled by the last keystroke must not re-render the
        // form mid-submit. `choose` already cancels, so a pick won't reach here.
        onBlur={() =>
          setTimeout(() => {
            setOpen(false)
            onDismiss()
          }, 120)
        }
        onKeyDown={onKeyDown}
      />
      {searching ? (
        <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-xs">
          Buscando…
        </span>
      ) : null}
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Produtos sugeridos"
          className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border p-1 shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              id={`catalog-name-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm ${
                i === activeIndex ? 'bg-accent text-accent-foreground' : ''
              }`}
              // mousedown (not click) so it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(s)
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{s.name}</span>
              {s.brand != null && s.brand !== '' ? (
                <span className="text-muted-foreground text-xs">{s.brand}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

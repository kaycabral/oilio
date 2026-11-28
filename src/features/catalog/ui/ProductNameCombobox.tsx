'use client'

import type { ProductSuggestion } from '@/features/catalog/core/catalog-item-form'
import { Input } from '@cbrl/design'
import { useEffect, useId, useRef, useState } from 'react'

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
  onQuery: (query: string) => void
  onSelect: (suggestion: ProductSuggestion) => void
  onCleared: () => void
  onDismiss: () => void
}) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (inputRef.current !== null) inputRef.current.value = suggestion.name
    setOpen(false)
    setActiveIndex(-1)
    onSelect(suggestion)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!showList) {
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
        onDismiss()
        break
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={`${uid}-catalog-name`}
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
        onBlur={() => {
          setOpen(false)
          onDismiss()
        }}
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

'use client'

import { formatBrazilPhone, maskBrazilPhone } from '@cbrl/br/phone'
import { Input } from '@cbrl/design'
import { useState, type ComponentProps } from 'react'

type PhoneInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'defaultValue'> & {
  defaultValue?: string
  onValueChange?: (masked: string) => void
}

export function PhoneInput({
  defaultValue = '',
  placeholder = '(11) 90000-0000',
  onValueChange,
  ...props
}: PhoneInputProps) {
  const [value, setValue] = useState(() => (defaultValue ? formatBrazilPhone(defaultValue) : ''))
  return (
    <Input
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const masked = maskBrazilPhone(e.target.value)
        setValue(masked)
        onValueChange?.(masked)
      }}
      {...props}
    />
  )
}

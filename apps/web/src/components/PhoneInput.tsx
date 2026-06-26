'use client'

import { formatBrazilPhone, maskBrazilPhone } from '@/domain'
import { Input } from '@cbrl/design'
import { useState, type ComponentProps } from 'react'

// Brazilian phone input with a live mask — "(11) 97000-0002" as you type. The
// initial value (a stored normalized number) is formatted for display; the field
// submits the masked string, which the server normalizes. Drop-in for the design
// `Input` on any phone/WhatsApp field.
type PhoneInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'defaultValue'> & {
  defaultValue?: string
}

export function PhoneInput({
  defaultValue = '',
  // Default placeholder mirrors the mask the field actually produces — DDD +
  // number, no country code (the `55` is added on normalize, server-side).
  placeholder = '(11) 90000-0000',
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
      onChange={(e) => setValue(maskBrazilPhone(e.target.value))}
      {...props}
    />
  )
}

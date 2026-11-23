import type { Customer } from '@/domain'
import { formatBirthDate } from '@/domain/types/customer'
import { formatBrazilPhone } from '@cbrl/br/phone'

export function CustomerDetail({ customer }: { customer: Customer }) {
  return (
    <dl className="divide-border divide-y rounded-md border">
      <Row label="Nome" value={customer.name} />
      <Row label="WhatsApp" value={customer.mobile ? formatBrazilPhone(customer.mobile) : '—'} />
      <Row label="Data de nascimento" value={formatBirthDate(customer.birthDate)} />
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  )
}

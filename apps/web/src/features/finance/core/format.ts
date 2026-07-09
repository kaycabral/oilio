const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatBrl(cents: number): string {
  return BRL.format(cents / 100)
}

/** Amount of a statement line in cents, as the server computes it when none is typed. */
export function lineAmount(quantity: number, unitCents: number): number {
  return Math.round(quantity * unitCents)
}

/** Subtotal, VAT (display only) and total, rounded like the server. */
export function statementTotals(amounts: number[], vatRate: number) {
  const subtotalCents = amounts.reduce((s, a) => s + a, 0)
  const vatCents = Math.round((subtotalCents * vatRate) / 100)
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents }
}

import { Schema } from 'effect'

// Catálogo per-org de categorias de despesa. Substitui o texto livre
// no movimento de caixa kind=despesa por uma referência estável — facilita
// agrupar despesas no relatório e evita ruído de digitação ("aluguel" vs
// "Aluguel" vs "alguel").
//
// Stored em `orgs/{orgId}/expense_categories/{id}`.
export const ExpenseCategory = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    name: Schema.String,
    // Soft-delete: categoria com movements históricos não pode ser apagada
    // (perderíamos o rótulo do passado), mas pode ser arquivada — somem da
    // UI de novo lançamento, continuam aparecendo no relatório.
    archived: Schema.Boolean,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type ExpenseCategory = typeof ExpenseCategory.Type

export const EXPENSE_CATEGORY_NAME_MIN = 2
export const EXPENSE_CATEGORY_NAME_MAX = 40

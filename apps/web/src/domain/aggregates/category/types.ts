import type { Category } from '@/domain/types/category'

export type CategoryState = Category & { readonly _version: number }

// Initial state — every field is overwritten by the `created` snapshot on
// replay (event-first: replay reconstructs the full doc from the stream).
export const INITIAL_CATEGORY_STATE: CategoryState = {
  id: '',
  orgId: '',
  name: '',
  icon: null,
  color: null,
  active: false,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}

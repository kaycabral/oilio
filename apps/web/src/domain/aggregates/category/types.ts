import type { Category } from '@/domain/types/category'

export type CategoryState = Category & { readonly _version: number }

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

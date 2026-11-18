import type { PaginationProps } from '@cbrl/design'

export const PAGINATION_LABELS_PTBR: PaginationProps['labels'] = {
  root: 'Paginação',
  previous: 'Página anterior',
  next: 'Próxima página',
  page: (page) => `Ir para a página ${page}`,
}

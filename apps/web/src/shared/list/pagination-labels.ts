import type { PaginationProps } from '@cbrl/design'

// pt-BR accessible labels for the design Pagination (its defaults are English so
// the shared layer stays language-neutral). One constant for every list page.
export const PAGINATION_LABELS_PTBR: PaginationProps['labels'] = {
  root: 'Paginação',
  previous: 'Página anterior',
  next: 'Próxima página',
  page: (page) => `Ir para a página ${page}`,
}

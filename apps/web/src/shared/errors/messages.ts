import type { ErrorCategory } from '@/shared/errors/classify'

export const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  conflict: 'Não foi possível concluir a operação (conflito de concorrência). Tente de novo.',
  integrity: 'Não foi possível concluir a operação por uma restrição de integridade dos dados.',
  forbidden: 'Você não tem permissão para concluir esta operação.',
  validation: 'Não foi possível concluir a operação: os dados enviados são inválidos.',
  unknown: 'Não foi possível concluir a operação.',
}

export function messageForCategory(category: ErrorCategory): string {
  return ERROR_MESSAGES[category]
}

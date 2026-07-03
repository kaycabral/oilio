import type { ErrorCategory } from '@/shared/errors/classify'

/**
 * The canonical, generic, user-facing message for each error category. This is
 * the ONLY text a classified defect ever shows the client — no SQLSTATE, no
 * constraint name, no internal event tag, no stack. The rich detail stays in the
 * server-side log (the boundary logs the raw defect before mapping).
 *
 * The `conflict` and `integrity` wording is preserved verbatim from the previous
 * `SAGA_CONFLICT_ERROR` / `SAGA_INTEGRITY_ERROR` constants so the observable
 * behaviour of the already-shipped 23505/FK handling (#1320) does not change.
 */
export const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  // 23505 version clash — two writers raced the same aggregate version. The only
  // genuinely retriable case, so the message invites a retry.
  conflict: 'Não foi possível concluir a operação (conflito de concorrência). Tente de novo.',
  // FK/CHECK — deterministic. "Tente de novo" would be a lie and hide a real bug
  // behind a flake-shaped message, so the message is honest and non-retriable.
  integrity: 'Não foi possível concluir a operação por uma restrição de integridade dos dados.',
  // RLS — the actor's scope doesn't permit the write. Neutral wording: it must
  // not confirm whether the target row exists (that would be a disclosure oracle).
  forbidden: 'Você não tem permissão para concluir esta operação.',
  // A schema rejection surfaced as a typed failure whose raw text can carry an
  // internal event tag — replaced by this generic message (the tag stays in the log).
  validation: 'Não foi possível concluir a operação: os dados enviados são inválidos.',
  // Anything unrecognised. Generic + NON-retriable: an unrecognised rolled-back
  // defect is still deterministic from the caller's side, so the message must not
  // invite a retry (that would reintroduce the flake-shaped "try again" #1320
  // forbids for a non-conflict). The full defect is in the server log.
  unknown: 'Não foi possível concluir a operação.',
}

/** The generic message for a classified category. */
export function messageForCategory(category: ErrorCategory): string {
  return ERROR_MESSAGES[category]
}

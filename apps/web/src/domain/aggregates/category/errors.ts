import { Data } from 'effect'

export class CategoryNotFoundError extends Data.TaggedError('CategoryNotFoundError')<{
  readonly categoryId: string
}> {}

// AC-05: a category referenced by at least one catalog item or subscription
// plan cannot be deleted (we'd orphan the FK). The caller surfaces this as a
// clear user-facing error instead of leaving a dangling reference.
export class CategoryInUseError extends Data.TaggedError('CategoryInUseError')<{
  readonly categoryId: string
}> {}

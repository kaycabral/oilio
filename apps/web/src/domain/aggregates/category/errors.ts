import { Data } from 'effect'

export class CategoryNotFoundError extends Data.TaggedError('CategoryNotFoundError')<{
  readonly categoryId: string
}> {}

export class CategoryInUseError extends Data.TaggedError('CategoryInUseError')<{
  readonly categoryId: string
}> {}

import { Data } from 'effect'

export class CatalogItemNotFoundError extends Data.TaggedError('CatalogItemNotFoundError')<{
  readonly catalogItemId: string
}> {}

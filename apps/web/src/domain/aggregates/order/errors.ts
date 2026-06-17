import { Data } from 'effect'

export class OrderAlreadyClosedError extends Data.TaggedError('OrderAlreadyClosedError')<{
  readonly orderId: string
}> {}

import { randomUUID } from 'node:crypto'
import 'server-only'

export function newId(): string {
  return randomUUID()
}

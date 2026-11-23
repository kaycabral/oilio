import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SMOKE_STORAGE_STATE = join(tmpdir(), 'oilio-smoke-storage-state.json')

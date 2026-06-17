// Pre-condição global da suíte E2E: garante que o stack do Firebase
// emulator não só tá com as portas bindadas (o `firebase emulators:exec`
// que embrulha o Playwright só libera quando os emuladores respondem),
// mas também round-trip-ready pra writes-then-queries que os seeds e specs
// assumem.
//
// Roda 1 vez, após `webServer` (Next) ficar pronto, antes do primeiro teste.
// Custa <500ms quando emulator tá saudável; throw com mensagem clara se
// não consistir em 30s (emulator unhealthy → bug, não flake).
//
// Por que existir: o readiness do emulators:exec garante portas bindadas,
// mas o Firestore pode não ter index pronto pra queries logo no boot — e
// Auth signup também pode ser racy no primeiro request. Isso expôs flake em
// `customer-dedupe` (seed escreve, server action query falha em achar).
// globalSetup elimina a janela.

import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from './emulator'
import { decodeFsQueryRows, parseJson } from './firestore-rest'

const API_KEY = 'fake-api-key'

const TIMEOUT_MS = 30_000
const INTERVAL_MS = 200

function curl(args: string[]): string {
  return execFileSync('curl', ['-fsS', ...args], { encoding: 'utf8' })
}

function tryFirestoreRoundtrip(): Promise<boolean> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const docPath = `e2e_warmup/${suffix}`
  const sentinel = `warmup-${suffix}`
  try {
    curl([
      '-X',
      'PATCH',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields: { sentinel: { stringValue: sentinel } } }),
    ])

    const queryResp = curl([
      '-X',
      'POST',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'e2e_warmup' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'sentinel' },
              op: 'EQUAL',
              value: { stringValue: sentinel },
            },
          },
          limit: 1,
        },
      }),
    ])

    const results = parseJson(queryResp, decodeFsQueryRows)
    if (!results.some((r) => r.document)) {
      return Promise.resolve(false)
    }

    // Cleanup — best-effort; emulator é ephemeral, mas evita lixo
    // visível se alguém abrir a UI ad-hoc.
    curl([
      '-X',
      'DELETE',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`,
      '-H',
      'Authorization: Bearer owner',
    ])
    return Promise.resolve(true)
  } catch {
    return Promise.resolve(false)
  }
}

function tryAuthSignup(): Promise<boolean> {
  const email = `warmup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  try {
    const resp = curl([
      '-X',
      'POST',
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ email, password: 'Warmup12345!', returnSecureToken: true }),
    ])
    const parsed = parseJson(
      resp,
      Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.optional(Schema.String) })),
    )
    return Promise.resolve(typeof parsed.localId === 'string' && parsed.localId.length > 0)
  } catch {
    return Promise.resolve(false)
  }
}

async function waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    if (await probe()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
  }
  throw new Error(`[e2e] ${label} warmup failed after ${TIMEOUT_MS}ms — emulator may be unhealthy`)
}

export default async function globalSetup(): Promise<void> {
  await Promise.all([waitFor('Firestore', tryFirestoreRoundtrip), waitFor('Auth', tryAuthSignup)])
}

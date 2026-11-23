import type { CookieOptions } from '@supabase/ssr'
import type { AuthError, JwtPayload, User } from '@supabase/supabase-js'

export type SessionCookie = { name: string; value: string; options: CookieOptions }

type CookieAdapter = {
  getAll: () => { name: string; value: string }[] | Promise<{ name: string; value: string }[]>
  setAll?: (cookies: SessionCookie[], headers: Record<string, string>) => void | Promise<void>
}

type ExchangeOutcome = { user: User; cookies: SessionCookie[] } | { error: AuthError }

type ClaimsOutcome =
  | { claims: JwtPayload | null; cookies: SessionCookie[]; headers: Record<string, string> }
  | { unreachable: unknown }

export class FakeSupabaseAuth {
  readonly clients: { url: string; key: string }[] = []
  readonly exchangedCodes: string[] = []
  readonly requestCookiesSeen: { name: string; value: string }[][] = []
  private exchange: ExchangeOutcome | null = null
  private claims: ClaimsOutcome = { claims: null, cookies: [], headers: {} }

  reset(): void {
    this.clients.length = 0
    this.exchangedCodes.length = 0
    this.requestCookiesSeen.length = 0
    this.exchange = null
    this.claims = { claims: null, cookies: [], headers: {} }
  }

  signsIn(user: User, cookies: SessionCookie[]): void {
    this.exchange = { user, cookies }
  }

  rejectsCode(error: AuthError): void {
    this.exchange = { error }
  }

  keepsSession(claims: JwtPayload): void {
    this.claims = { claims, cookies: [], headers: {} }
  }

  refreshesSession(
    claims: JwtPayload,
    cookies: SessionCookie[],
    headers: Record<string, string>,
  ): void {
    this.claims = { claims, cookies, headers }
  }

  isUnreachable(error: unknown): void {
    this.claims = { unreachable: error }
  }

  readonly createServerClient = (url: string, key: string, options: { cookies: CookieAdapter }) => {
    this.clients.push({ url, key })
    const adapter = options.cookies
    return {
      auth: {
        exchangeCodeForSession: (code: string) => this.exchangeCode(code, adapter),
        getClaims: () => this.readClaims(adapter),
      },
    }
  }

  private async exchangeCode(code: string, adapter: CookieAdapter) {
    this.exchangedCodes.push(code)
    const outcome = this.exchange
    if (outcome === null) throw new Error('FakeSupabaseAuth: no exchange outcome scripted')
    if ('error' in outcome) return { data: { user: null, session: null }, error: outcome.error }
    await adapter.setAll?.(outcome.cookies, {})
    return { data: { user: outcome.user, session: {} }, error: null }
  }

  private async readClaims(adapter: CookieAdapter) {
    this.requestCookiesSeen.push(await adapter.getAll())
    const outcome = this.claims
    if ('unreachable' in outcome) throw outcome.unreachable
    if (outcome.cookies.length > 0) await adapter.setAll?.(outcome.cookies, outcome.headers)
    return { data: outcome.claims ? { claims: outcome.claims } : null, error: null }
  }
}

export class FakeCookieStore {
  private readonly jar = new Map<string, SessionCookie>()

  reset(): void {
    this.jar.clear()
  }

  getAll(): { name: string; value: string }[] {
    return [...this.jar.values()].map(({ name, value }) => ({ name, value }))
  }

  get(name: string): SessionCookie | undefined {
    return this.jar.get(name)
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.jar.set(name, { name, value, options })
  }
}

export const fakeSupabaseAuth = new FakeSupabaseAuth()
export const fakeCookieStore = new FakeCookieStore()
export const createServerClient = fakeSupabaseAuth.createServerClient

// Typed JSON read boundary for the E2E suite (Auth emulator REST + app routes).
//
// `JSON.parse()` returns `any` and `Response.json()` returns `Promise<any>`, so
// every spec used to assert `JSON.parse(out) as T` / `(await res.json()).x` at
// the call site — scattering `no-unsafe-*` violations. This module is the ONE
// place the `unknown -> T` conversion lives: `parseJson` / `readJson` REQUIRE a
// decoder (an Effect `Schema.decodeUnknownSync(X)`), so every caller runtime-
// validates the shape it reads — there is no unchecked `as T` anywhere.
//
// E2E runs in Node, so Effect `Schema` is fine here. Ad-hoc response shapes get
// a small local `Schema.Struct` at the call site. Decoding is lenient — schemas
// describe only the fields a caller touches and ignore excess properties
// (Effect's default `onExcessProperty: 'ignore'`), so a richer real response
// decodes fine.

/**
 * Destructure the first two ids off a unit-id list with a runtime guard,
 * narrowing `string[]` to a definite pair instead of asserting a tuple shape.
 */
export function twoUnits(ids: string[]): [string, string] {
  const [a, b] = ids
  if (a === undefined || b === undefined) {
    throw new Error(`expected at least 2 unit ids, got ${ids.length}`)
  }
  return [a, b]
}

/** First unit id with a runtime guard (no tuple assertion). */
export function oneUnit(ids: string[]): [string] {
  const [a] = ids
  if (a === undefined) {
    throw new Error('expected at least 1 unit id, got 0')
  }
  return [a]
}

/**
 * The ONE parse in the E2E read path. `JSON.parse` yields `any`; this is the
 * single `unknown -> T` boundary, and it REQUIRES a `decode` that runtime-
 * validates the shape (an Effect `Schema.decodeUnknownSync(X)`), so the suite
 * never asserts an unchecked `as T`.
 */
export function parseJson<T>(raw: string, decode: (u: unknown) => T): T {
  return decode(JSON.parse(raw))
}

/** Same validated boundary for `fetch` responses (`Response.json()` is `any`). */
export async function readJson<T>(res: Response, decode: (u: unknown) => T): Promise<T> {
  return parseJson(await res.text(), decode)
}

// Typed read boundary for the Firestore / Auth emulator REST APIs used across
// the E2E suite.
//
// `JSON.parse()` returns `any` and `Response.json()` returns `Promise<any>`, so
// every spec used to assert `JSON.parse(out) as T` / `(await res.json()).x` at
// the call site — scattering `no-unsafe-*` violations. This module is the ONE
// place the `unknown -> T` conversion lives: `parseJson` / `readJson` REQUIRE a
// decoder (an Effect `Schema.decodeUnknownSync(X)`), so every caller runtime-
// validates the shape it reads — there is no unchecked `as T` anywhere.
//
// E2E runs in Node, so Effect `Schema` is fine here. Reusable schemas for the
// recurring Firestore REST shapes (`FsValue`, `FsDocument`, list/query
// responses) are defined and exported below; ad-hoc shapes get a small local
// `Schema.Struct` at the call site. Decoding is lenient — schemas describe only
// the fields a caller touches and ignore excess properties (Effect's default
// `onExcessProperty: 'ignore'`), so a real, richer emulator response decodes
// fine.

import { Schema } from 'effect'

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
 * A Firestore typed-value (the wire encoding for a single field). Recursive
 * (array/map nest more values) — modelled with `Schema.suspend`.
 */
export const FsValueSchema: Schema.Schema<FsValue> = Schema.suspend(() =>
  Schema.Struct({
    stringValue: Schema.optional(Schema.String),
    integerValue: Schema.optional(Schema.String),
    doubleValue: Schema.optional(Schema.Number),
    booleanValue: Schema.optional(Schema.Boolean),
    nullValue: Schema.optional(Schema.Null),
    arrayValue: Schema.optional(
      Schema.Struct({ values: Schema.optional(Schema.Array(FsValueSchema)) }),
    ),
    mapValue: Schema.optional(
      Schema.Struct({
        fields: Schema.optional(Schema.Record({ key: Schema.String, value: FsValueSchema })),
      }),
    ),
    timestampValue: Schema.optional(Schema.String),
  }),
)

/** A Firestore typed-value (the wire encoding for a single field). */
export type FsValue = {
  stringValue?: string
  integerValue?: string
  doubleValue?: number
  booleanValue?: boolean
  nullValue?: null
  arrayValue?: { values?: readonly FsValue[] }
  mapValue?: { fields?: { readonly [key: string]: FsValue } }
  timestampValue?: string
}

/** A Firestore REST document: `name` path + typed `fields` map. */
export const FsDocumentSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Record({ key: Schema.String, value: FsValueSchema })),
  createTime: Schema.optional(Schema.String),
  updateTime: Schema.optional(Schema.String),
})

/** A Firestore REST document: `name` path + typed `fields` map. */
export type FsDocument = typeof FsDocumentSchema.Type

/** A `:get` on a collection returns `{ documents: [...] }`. */
export const FsListResponseSchema = Schema.Struct({
  documents: Schema.optional(Schema.Array(FsDocumentSchema)),
})

/** A `:get` on a collection returns `{ documents: [...] }`. */
export type FsListResponse = typeof FsListResponseSchema.Type

/** A `:runQuery` returns an array of `{ document? }` rows. */
export const FsQueryRowSchema = Schema.Struct({
  document: Schema.optional(FsDocumentSchema),
})

/** A `:runQuery` returns an array of `{ document? }` rows. */
export type FsQueryRow = typeof FsQueryRowSchema.Type

/** A `:runQuery` response: an array of query rows. */
export const FsQueryRowsSchema = Schema.Array(FsQueryRowSchema)

/** The `{ fields?: Record<string, FsValue> }` doc shape (a doc read for its fields). */
export const FsFieldsDocSchema = Schema.Struct({
  fields: Schema.optional(Schema.Record({ key: Schema.String, value: FsValueSchema })),
})

/** Decoder for {@link FsValue} — the recurring single typed-value shape. */
export const decodeFsValue: (u: unknown) => FsValue = Schema.decodeUnknownSync(FsValueSchema)
/** Decoder for {@link FsDocument}. */
export const decodeFsDocument: (u: unknown) => FsDocument =
  Schema.decodeUnknownSync(FsDocumentSchema)
/** Decoder for {@link FsListResponse}. */
export const decodeFsListResponse: (u: unknown) => FsListResponse =
  Schema.decodeUnknownSync(FsListResponseSchema)
/** Decoder for a `:runQuery` rows array. */
export const decodeFsQueryRows: (u: unknown) => readonly FsQueryRow[] =
  Schema.decodeUnknownSync(FsQueryRowsSchema)
/** Decoder for the `{ fields?: Record<string, FsValue> }` doc shape. */
export const decodeFsFieldsDoc: (u: unknown) => typeof FsFieldsDocSchema.Type =
  Schema.decodeUnknownSync(FsFieldsDocSchema)

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

// ----------------------------------------------------------------------------
// Typed field accessors — read a single Firestore typed-value off a `fields`
// map without a per-call-site assertion. `fields` is `Record<string, FsValue>`
// (or `Record<string, unknown>` from a generic read); accept either and narrow
// here, so the cast lives in ONE place instead of at every `fields.x.stringValue`.
// ----------------------------------------------------------------------------

type FsFields = Record<string, FsValue | undefined> | undefined

function valueAt(fields: FsFields, key: string): FsValue | undefined {
  return fields?.[key]
}

/** `fields[key].stringValue` — `undefined` when absent or not a string field. */
export function strField(fields: FsFields, key: string): string | undefined {
  return valueAt(fields, key)?.stringValue
}

/** `fields[key].integerValue` (Firestore encodes ints as strings). */
export function intStrField(fields: FsFields, key: string): string | undefined {
  return valueAt(fields, key)?.integerValue
}

/** `fields[key].booleanValue`. */
export function boolField(fields: FsFields, key: string): boolean | undefined {
  return valueAt(fields, key)?.booleanValue
}

/** True when `fields[key]` is the Firestore `nullValue` sentinel. */
export function isNullField(fields: FsFields, key: string): boolean {
  const v = valueAt(fields, key)
  return v !== undefined && 'nullValue' in v
}

/**
 * Read `.stringValue` off a single Firestore typed-value of unknown static type
 * (e.g. a field pulled from a `Record<string, unknown>` document map) by
 * narrowing at runtime instead of asserting the shape. `undefined` when the
 * value isn't an object carrying a string `stringValue`.
 */
export function stringValueOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'stringValue' in value) {
    const sv: unknown = value.stringValue
    return typeof sv === 'string' ? sv : undefined
  }
  return undefined
}

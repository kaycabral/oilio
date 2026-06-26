// Typed JSON read boundary for `fetch`/`Request` bodies.
//
// `Response.json()` / `Request.json()` are typed `Promise<any>` by the DOM lib.
// `readJson` REQUIRES a `validate` that turns the parsed `unknown` into `T` with
// a real runtime check (an Effect `Schema.decodeUnknownSync(X)` on the server,
// or a hand guard on the client to keep Effect out of the browser bundle) — so
// there is no unchecked `as T` anywhere.

export type Validate<T> = (data: unknown) => T

interface JsonReadable {
  json(): Promise<unknown>
}

/** Parse a JSON body and validate it into `T`. */
export async function readJson<T>(source: JsonReadable, validate: Validate<T>): Promise<T> {
  return validate(await source.json())
}

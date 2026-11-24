export function twoUnits(ids: string[]): [string, string] {
  const [a, b] = ids
  if (a === undefined || b === undefined) {
    throw new Error(`expected at least 2 unit ids, got ${ids.length}`)
  }
  return [a, b]
}

export function oneUnit(ids: string[]): [string] {
  const [a] = ids
  if (a === undefined) {
    throw new Error('expected at least 1 unit id, got 0')
  }
  return [a]
}

export function parseJson<T>(raw: string, decode: (u: unknown) => T): T {
  return decode(JSON.parse(raw))
}

export async function readJson<T>(res: Response, decode: (u: unknown) => T): Promise<T> {
  return parseJson(await res.text(), decode)
}

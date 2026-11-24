export type Validate<T> = (data: unknown) => T

interface JsonReadable {
  json(): Promise<unknown>
}

export async function readJson<T>(source: JsonReadable, validate: Validate<T>): Promise<T> {
  return validate(await source.json())
}

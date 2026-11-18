import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type Timings = Record<string, number>

const E2E_DIR = path.join('tests', 'e2e')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key]
  return Array.isArray(field) ? field : []
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function listSpecFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSpecFiles(full)
    return entry.name.endsWith('.spec.ts') ? [full] : []
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 1
  const lower = sorted[Math.ceil(sorted.length / 2) - 1] ?? upper
  return (lower + upper) / 2
}

function parseTimings(value: unknown): Timings {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  )
}

/**
 * Longest-processing-time-first: the heaviest spec goes to the currently
 * lightest shard; ties go to the shard with fewer specs.
 *
 * @returns the spec files of shard `index` (one-based), sorted.
 */
function planShard(specs: string[], timings: Timings, index: number, total: number): string[] {
  const known = specs.flatMap((spec) => {
    const ms = timings[spec]
    return ms === undefined ? [] : [ms]
  })
  const fallback = median(known)
  const weighted = specs
    .map((spec) => ({ spec, ms: timings[spec] ?? fallback }))
    .sort((a, b) => b.ms - a.ms || a.spec.localeCompare(b.spec))
  const shards = Array.from({ length: total }, () => ({ ms: 0, specs: [] as string[] }))
  for (const { spec, ms } of weighted) {
    const lightest = shards.reduce((min, shard) =>
      shard.ms < min.ms || (shard.ms === min.ms && shard.specs.length < min.specs.length)
        ? shard
        : min,
    )
    lightest.ms += ms
    lightest.specs.push(spec)
  }
  return (shards[index - 1]?.specs ?? []).sort()
}

function specDuration(spec: Record<string, unknown>): number {
  return arrayField(spec, 'tests')
    .filter(isRecord)
    .flatMap((test) => arrayField(test, 'results'))
    .filter(isRecord)
    .reduce((sum, result) => sum + (typeof result.duration === 'number' ? result.duration : 0), 0)
}

function addSuite(suite: Record<string, unknown>, into: Timings): void {
  for (const spec of arrayField(suite, 'specs').filter(isRecord)) {
    if (typeof spec.file !== 'string') continue
    const file = path.join(E2E_DIR, spec.file)
    into[file] = (into[file] ?? 0) + specDuration(spec)
  }
  for (const child of arrayField(suite, 'suites').filter(isRecord)) addSuite(child, into)
}

/**
 * @returns per-spec total duration (ms) across Playwright JSON reports, keyed by
 * the path relative to the app (`tests/e2e/...`).
 */
function timingsFromReports(reports: unknown[]): Timings {
  const timings: Timings = {}
  for (const report of reports.filter(isRecord)) {
    for (const suite of arrayField(report, 'suites').filter(isRecord)) addSuite(suite, timings)
  }
  return timings
}

function plan([timingsFile, index, total]: string[]): number {
  if (!timingsFile || !existsSync(timingsFile)) return 2
  const timings = parseTimings(readJson(timingsFile))
  const specs = listSpecFiles(E2E_DIR)
  console.log(planShard(specs, timings, Number(index), Number(total)).join('\n'))
  return 0
}

function record([out, ...reportFiles]: string[]): number {
  if (!out) return 1
  const timings = timingsFromReports(reportFiles.map(readJson))
  writeFileSync(out, JSON.stringify(timings, null, 2))
  console.log(`${Object.keys(timings).length} spec timings from ${reportFiles.length} reports`)
  return 0
}

const commands: Record<string, (args: string[]) => number> = { plan, record }
const [command = '', ...rest] = process.argv.slice(2)
const run = commands[command]
if (run) {
  process.exitCode = run(rest)
} else {
  console.error(
    'usage: e2e-shards.ts plan <timings.json> <index> <total> | record <out.json> <report.json>...',
  )
  process.exitCode = 1
}

import * as duckdb from "@duckdb/duckdb-wasm"

/**
 * One in-browser DuckDB per loaded file. Each new file gets a fresh instance
 * because external access is locked off after loading and cannot be re-enabled.
 * Only DuckDB's engine code comes from the CDN; user data never leaves the tab.
 */
let current: Promise<duckdb.AsyncDuckDB> | null = null
/** An instance started ahead of time (on page load) so the first file doesn't wait for the engine. */
let spare: Promise<duckdb.AsyncDuckDB> | null = null

async function createDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
  if (!bundle.mainWorker) throw new Error("DuckDB worker bundle not found")
  // Cross-origin workers are not allowed, so bootstrap the CDN worker from a same-origin blob.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  )
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl))
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  URL.revokeObjectURL(workerUrl)
  return db
}

/** Starts downloading and instantiating DuckDB in the background, if not already done. */
export function prewarmDb(): void {
  if (spare) return
  spare = createDb()
  // A failed warm-up (e.g. offline) is not an error yet; the real load retries and reports it.
  spare.catch(() => {
    spare = null
  })
}

export async function freshDb(): Promise<duckdb.AsyncDuckDB> {
  const previous = current
  current = spare ?? createDb()
  spare = null
  if (previous) await (await previous).terminate()
  return current
}

export async function currentDb(): Promise<duckdb.AsyncDuckDB> {
  if (!current) throw new Error("No file loaded yet.")
  return current
}

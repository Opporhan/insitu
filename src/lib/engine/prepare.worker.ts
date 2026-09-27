import { ingest } from "@/lib/ingest"
import type { PrepareRequest, PrepareResponse, PreparedTable } from "./prepare"

// Runs off the main thread: decoding, delimiter sniffing, Excel/PDF parsing, OCR and table
// tidying never block the UI, even for large files.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PrepareRequest>) => void) | null
  postMessage(message: PrepareResponse, transfer?: Transferable[]): void
}

const encode = (csv: string) => new TextEncoder().encode(csv)

ctx.onmessage = async (e) => {
  try {
    const result = await ingest(e.data.file.name, await e.data.file.arrayBuffer(), e.data.sheet, (progress) =>
      ctx.postMessage({ ok: true, kind: "progress", progress }),
    )
    if (result.kind === "sheets") {
      const tables: Record<string, PreparedTable> | null = result.tables
        ? Object.fromEntries(Object.entries(result.tables).map(([name, t]) => [name, { bytes: encode(t.csv), report: t.report }]))
        : null
      ctx.postMessage(
        { ok: true, kind: "sheets", sheets: result.sheets, tables },
        Object.values(tables ?? {}).map((t) => t.bytes.buffer),
      )
      return
    }
    const bytes = encode(result.csv)
    ctx.postMessage({ ok: true, kind: "table", bytes, report: result.report }, [bytes.buffer])
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message || err.name : String(err) })
  }
}

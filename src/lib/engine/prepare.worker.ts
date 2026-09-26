import { ingest } from "@/lib/ingest"
import type { PrepareRequest, PrepareResponse } from "./prepare"

// Runs off the main thread: decoding, delimiter sniffing, Excel parsing and table tidying
// never block the UI, even for large files.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PrepareRequest>) => void) | null
  postMessage(message: PrepareResponse, transfer?: Transferable[]): void
}

ctx.onmessage = async (e) => {
  try {
    const result = ingest(e.data.file.name, await e.data.file.arrayBuffer(), e.data.sheet)
    if (result.kind === "sheets") {
      ctx.postMessage({ ok: true, kind: "sheets", sheets: result.sheets })
      return
    }
    const bytes = new TextEncoder().encode(result.csv)
    ctx.postMessage({ ok: true, kind: "table", bytes, report: result.report }, [bytes.buffer])
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

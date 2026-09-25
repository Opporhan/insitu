import { prepareBytes, type PrepareRequest, type PrepareResponse } from "./prepare"

// Runs off the main thread: Excel parsing and re-encoding of large files never block the UI.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PrepareRequest>) => void) | null
  postMessage(message: PrepareResponse, transfer?: Transferable[]): void
}

ctx.onmessage = async (e) => {
  try {
    const bytes = await prepareBytes(e.data.file)
    ctx.postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

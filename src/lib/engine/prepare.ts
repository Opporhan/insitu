import type { IngestReport, SheetInfo } from "@/lib/ingest"

export type PrepareRequest = { file: File; sheet?: string }

export type PrepareResponse =
  | { ok: true; kind: "sheets"; sheets: SheetInfo[] }
  | { ok: true; kind: "table"; bytes: Uint8Array<ArrayBuffer>; report: IngestReport }
  | { ok: false; error: string }

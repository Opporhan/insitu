import type { IngestReport, PdfProgress, SheetInfo } from "@/lib/ingest"

export type PrepareRequest = { file: File; sheet?: string }

export type PreparedTable = { bytes: Uint8Array<ArrayBuffer>; report: IngestReport }

export type PrepareResponse =
  /** `tables`: every choice already prepared (PDF), so picking one needs no second read. */
  | { ok: true; kind: "sheets"; sheets: SheetInfo[]; tables: Record<string, PreparedTable> | null }
  | ({ ok: true; kind: "table" } & PreparedTable)
  | { ok: true; kind: "progress"; progress: PdfProgress }
  | { ok: false; error: string }

import { xlsxToCsv } from "./xlsx-to-csv"

export type PrepareRequest = { file: File }
export type PrepareResponse = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; error: string }

export const EXCEL_EXTENSIONS = [".xlsx", ".xls"] as const

export function extension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

const encoder = new TextEncoder()

function stripBom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
}

/**
 * Turns an uploaded file into UTF-8 CSV bytes for DuckDB. Excel is converted to CSV;
 * CSV that is not valid UTF-8 is assumed to be Windows-1254 (Turkish Excel's
 * default "CSV" export) and re-encoded, so "ş, ğ, ı" survive.
 */
export async function prepareBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await file.arrayBuffer()
  if ((EXCEL_EXTENSIONS as readonly string[]).includes(extension(file.name))) {
    return encoder.encode(xlsxToCsv(buffer))
  }
  const bytes = stripBom(new Uint8Array(buffer))
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return bytes
  } catch {
    return encoder.encode(new TextDecoder("windows-1254").decode(bytes))
  }
}

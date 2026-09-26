import { decodeText, type TextEncodingName } from "./decode"
import { listSheets, parseDelimited, readWorkbook, sheetMatrix, type SheetInfo } from "./sources"
import { tidyMatrix, toCsvText, type TidyReport } from "./tidy"

export type { SheetInfo } from "./sources"
export type { TidyReport } from "./tidy"

export const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm"] as const

export function extension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

export type IngestReport = TidyReport & {
  source: "csv" | "excel"
  encoding: TextEncodingName | null
  delimiter: string | null
  sheet: string | null
  sheets: SheetInfo[]
}

export type IngestResult =
  | { kind: "sheets"; sheets: SheetInfo[] }
  | { kind: "table"; csv: string; report: IngestReport }

/**
 * Universal ingestion: any CSV/TSV/Excel → one clean UTF-8 CSV for DuckDB plus a report
 * of every change. For a workbook with several filled sheets and no `sheet` chosen yet,
 * returns the sheet list so the user can pick.
 */
export function ingest(fileName: string, data: ArrayBuffer, sheet?: string): IngestResult {
  if ((EXCEL_EXTENSIONS as readonly string[]).includes(extension(fileName))) {
    const workbook = readWorkbook(data)
    const sheets = listSheets(workbook)
    if (sheets.length === 0) throw new Error("no-sheet")
    if (sheet === undefined && sheets.length > 1) return { kind: "sheets", sheets }
    const chosen = sheets.find((s) => s.name === sheet) ?? sheets[0]
    if (!chosen) throw new Error("no-sheet")
    const table = tidyMatrix(sheetMatrix(workbook, chosen.name))
    if (table.header.length === 0) throw new Error("no-columns")
    return {
      kind: "table",
      csv: toCsvText(table),
      report: { ...table.report, source: "excel", encoding: null, delimiter: null, sheet: chosen.name, sheets },
    }
  }

  const { text, encoding } = decodeText(new Uint8Array(data))
  const { rows, delimiter } = parseDelimited(text)
  const table = tidyMatrix(rows)
  if (table.header.length === 0) throw new Error("no-columns")
  return {
    kind: "table",
    csv: toCsvText(table),
    report: { ...table.report, source: "csv", encoding, delimiter, sheet: null, sheets: [] },
  }
}

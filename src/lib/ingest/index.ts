import { decodeText, type TextEncodingName } from "./decode"
import { listSheets, parseDelimited, readWorkbook, sheetMatrix, type SheetInfo } from "./sources"
import { tidyMatrix, toCsvText, type TidyReport } from "./tidy"
import type { PdfProgress } from "./pdf"

export type { SheetInfo } from "./sources"
export type { TidyReport } from "./tidy"
export type { PdfProgress } from "./pdf"

export const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm"] as const

export function extension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

/** What reading a PDF involved; null for CSV/Excel. */
export type PdfReport = {
  pages: number
  /** Pages of the chosen table. */
  tablePages: [number, number]
  ocrPages: number
  skippedOcrPages: number
  lowConfidenceWords: number
  droppedPageFurniture: number
  mergedWrappedRows: number
}

export type IngestReport = TidyReport & {
  source: "csv" | "excel" | "pdf"
  encoding: TextEncodingName | null
  delimiter: string | null
  sheet: string | null
  sheets: SheetInfo[]
  pdf: PdfReport | null
}

type Table = { csv: string; report: IngestReport }

export type IngestResult =
  /** Several sheets/tables: the user picks one. PDF tables come fully prepared (`tables`), so picking one never reads (or OCRs) the file again. */
  | { kind: "sheets"; sheets: SheetInfo[]; tables: Record<string, Table> | null }
  | ({ kind: "table" } & Table)

export const PDF_EXTENSION = ".pdf"

/**
 * Universal ingestion: any CSV/TSV/Excel → one clean UTF-8 CSV for DuckDB plus a report
 * of every change. For a workbook with several filled sheets and no `sheet` chosen yet,
 * returns the sheet list so the user can pick.
 */
export async function ingest(
  fileName: string,
  data: ArrayBuffer,
  sheet?: string,
  onProgress?: (p: PdfProgress) => void,
): Promise<IngestResult> {
  if (extension(fileName) === PDF_EXTENSION) return ingestPdf(data, sheet, onProgress)

  if ((EXCEL_EXTENSIONS as readonly string[]).includes(extension(fileName))) {
    const workbook = readWorkbook(data)
    const sheets = listSheets(workbook)
    if (sheets.length === 0) throw new Error("no-sheet")
    if (sheet === undefined && sheets.length > 1) return { kind: "sheets", sheets, tables: null }
    const chosen = sheets.find((s) => s.name === sheet) ?? sheets[0]
    if (!chosen) throw new Error("no-sheet")
    const table = tidyMatrix(sheetMatrix(workbook, chosen.name))
    if (table.header.length === 0) throw new Error("no-columns")
    return {
      kind: "table",
      csv: toCsvText(table),
      report: { ...table.report, source: "excel", encoding: null, delimiter: null, sheet: chosen.name, sheets, pdf: null },
    }
  }

  const { text, encoding } = decodeText(new Uint8Array(data))
  const { rows, delimiter } = parseDelimited(text)
  const table = tidyMatrix(rows)
  if (table.header.length === 0) throw new Error("no-columns")
  return {
    kind: "table",
    csv: toCsvText(table),
    report: { ...table.report, source: "csv", encoding, delimiter, sheet: null, sheets: [], pdf: null },
  }
}

/**
 * PDF → tables (text layer, or OCR for scanned pages) → the same tidy step as CSV/Excel.
 * Every table found becomes a choice, like the sheets of a workbook.
 */
async function ingestPdf(data: ArrayBuffer, sheet: string | undefined, onProgress?: (p: PdfProgress) => void): Promise<IngestResult> {
  const { readPdf } = await import("./pdf")
  const pdf = await readPdf(data, onProgress)
  const prepared = pdf.tables.flatMap((t) => {
    const table = tidyMatrix(t.matrix)
    return table.header.length >= 2 && table.rows.length > 0 ? [{ table, pages: t.pages }] : []
  })
  if (prepared.length === 0) throw new Error("pdf-no-table")
  const sheets: SheetInfo[] = prepared.map(({ table, pages }, i) => ({
    name: String(i + 1),
    rows: table.report.rowCount,
    columns: table.report.columnCount,
    pages,
  }))
  const tables: Record<string, Table> = {}
  prepared.forEach(({ table, pages }, i) => {
    const name = String(i + 1)
    tables[name] = {
      csv: toCsvText(table),
      report: {
        ...table.report,
        source: "pdf",
        encoding: null,
        delimiter: null,
        sheet: prepared.length > 1 ? name : null,
        sheets: prepared.length > 1 ? sheets : [],
        pdf: {
          pages: pdf.pages,
          tablePages: pages,
          ocrPages: pdf.ocrPages,
          skippedOcrPages: pdf.skippedOcrPages,
          lowConfidenceWords: pdf.lowConfidenceWords,
          droppedPageFurniture: pdf.droppedPageFurniture,
          mergedWrappedRows: pdf.mergedWrappedRows,
        },
      },
    }
  })
  const chosen = sheet !== undefined ? tables[sheet] : prepared.length === 1 ? tables["1"] : undefined
  if (chosen) return { kind: "table", ...chosen }
  return { kind: "sheets", sheets, tables }
}

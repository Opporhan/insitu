import Papa from "papaparse"
import { read, SSF, type CellObject, type WorkBook } from "xlsx"

/** A raw cell: trimmed text, or null when empty. */
export type Cell = string | null
export type Matrix = Cell[][]

export const DELIMITERS = [",", ";", "\t", "|"] as const

function clean(value: string): Cell {
  // Non-breaking and zero-width spaces are common in copied/exported data.
  const s = value.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").trim()
  return s === "" ? null : s
}

/** CSV/TSV text → cells. The delimiter is sniffed from `,` `;` tab `|` by field-count consistency. */
export function parseDelimited(text: string): { rows: Matrix; delimiter: string } {
  const result = Papa.parse<string[]>(text, { delimitersToGuess: [...DELIMITERS], skipEmptyLines: false })
  return { rows: result.data.map((r) => r.map((v) => clean(String(v ?? "")))), delimiter: result.meta.delimiter }
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Excel serial → "YYYY-MM-DD[ HH:MM:SS]" without JS Date, so no timezone shifts. */
function serialToIso(serial: number): string | null {
  const d = SSF.parse_date_code(serial)
  if (!d) return null
  const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`
  return d.H || d.M || d.S ? `${date} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : date
}

function excelCell(cell: CellObject | undefined): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return null
  switch (cell.t) {
    case "n":
      if (typeof cell.v === "number" && cell.z !== undefined && SSF.is_date(cell.z)) return serialToIso(cell.v)
      return clean(String(cell.v))
    case "e": // #DIV/0!, #N/A… carry no value
    case "z":
      return null
    default:
      return clean(String(cell.v))
  }
}

export function readWorkbook(data: ArrayBuffer): WorkBook {
  return read(data, { dense: true, cellNF: true })
}

/** Cells of one sheet, with raw numbers and ISO dates. */
export function sheetMatrix(workbook: WorkBook, name: string): Matrix {
  const sheet = workbook.Sheets[name]
  const rows: (CellObject | undefined)[][] = sheet?.["!data"] ?? []
  // Array.from (not map): SheetJS leaves holes for empty rows/cells, which map would skip.
  return Array.from(rows, (row) => Array.from(row ?? [], (c) => excelCell(c)))
}

export type SheetInfo = { name: string; rows: number; columns: number }

/** Sheets that contain any value, with their filled size. */
export function listSheets(workbook: WorkBook): SheetInfo[] {
  return workbook.SheetNames.flatMap((name) => {
    const m = sheetMatrix(workbook, name)
    const filled = m.filter((r) => r.some((c) => c !== null))
    if (filled.length === 0) return []
    const columns = Math.max(...filled.map((r) => r.reduce((last, c, i) => (c !== null ? i + 1 : last), 0)))
    return [{ name, rows: filled.length, columns }]
  })
}

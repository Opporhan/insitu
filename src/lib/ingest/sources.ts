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

/**
 * The delimiter under which the first lines (header included) split into the same number of
 * fields most often, with at least two fields. Papa's own guess can pick "," for Turkish
 * exports like "ilce;tutar / Kadıköy;12,50", where every value has a decimal comma.
 */
function sniffDelimiter(text: string): string | null {
  const sample = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 50).join("\n")
  let best: { delimiter: string; agreeing: number; fields: number } | null = null
  for (const delimiter of DELIMITERS) {
    const counts = Papa.parse<string[]>(sample, { delimiter }).data.map((r) => r.length)
    const tally = new Map<number, number>()
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1)
    const [fields, agreeing] = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0]
    if (fields < 2) continue
    if (!best || agreeing > best.agreeing || (agreeing === best.agreeing && fields > best.fields)) best = { delimiter, agreeing, fields }
  }
  return best?.delimiter ?? null
}

/** CSV/TSV text → cells. The delimiter is sniffed from `,` `;` tab `|` by field-count consistency. */
export function parseDelimited(text: string): { rows: Matrix; delimiter: string } {
  const sniffed = sniffDelimiter(text)
  const result = Papa.parse<string[]>(text, {
    ...(sniffed ? { delimiter: sniffed } : { delimitersToGuess: [...DELIMITERS] }),
    skipEmptyLines: false,
  })
  return { rows: result.data.map((r) => r.map((v) => clean(String(v ?? "")))), delimiter: result.meta.delimiter }
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * Excel serial → "YYYY-MM-DD[ HH:MM:SS]" without JS Date, so no timezone shifts. Workbooks
 * saved with the 1904 date system (older Mac Excel) count from 1904; ignoring that shifts
 * every date by four years. A time-only cell (format like "hh:mm") becomes "HH:MM:SS".
 */
function serialToIso(serial: number, date1904: boolean, format: string): string | null {
  const d = SSF.parse_date_code(serial, { date1904 }) as
    | { y: number; m: number; d: number; H: number; M: number; S: number }
    | null
    | undefined
  if (!d) return null
  const time = `${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`
  // Only time tokens in the format (h, m, s, AM/PM, [h] for durations): the cell is a time of day.
  if (/^[\[\]hms:.\s0ap/"]+$/i.test(format.replace(/am\/pm|a\/p/gi, ""))) return time
  const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`
  return d.H || d.M || d.S ? `${date} ${time}` : date
}

/** Plain decimal text: 1e-7 or 1e+21 would otherwise turn a whole numeric column into text. */
function numberText(n: number): string {
  const s = String(n)
  return /e/i.test(s) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : s
}

function excelCell(cell: CellObject | undefined, date1904: boolean): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return null
  switch (cell.t) {
    case "n":
      if (typeof cell.v === "number" && cell.z !== undefined && SSF.is_date(cell.z)) return serialToIso(cell.v, date1904, String(cell.z))
      return typeof cell.v === "number" ? clean(numberText(cell.v)) : clean(String(cell.v))
    case "e": // #DIV/0!, #N/A… carry no value
    case "z":
      return null
    default:
      return clean(String(cell.v))
  }
}

export function readWorkbook(data: ArrayBuffer): WorkBook {
  // cellStyles: needed for row visibility ("!rows"); costs ~5% on a 100k-row workbook.
  return read(data, { dense: true, cellNF: true, cellStyles: true })
}

export type SheetRead = {
  matrix: Matrix
  /** Empty cells of merged ranges filled with the range's value ("İstanbul" merged over 5 rows). */
  filledMergedCells: number
  /** Rows hidden (or filtered out) in Excel; they are kept, as Excel's own SUM keeps them. */
  hiddenRows: number
}

/** Cells of one sheet, with raw numbers and ISO dates; merged ranges filled in. */
export function readSheet(workbook: WorkBook, name: string): SheetRead {
  const sheet = workbook.Sheets[name]
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904)
  const rows: (CellObject | undefined)[][] = sheet?.["!data"] ?? []
  // Array.from (not map): SheetJS leaves holes for empty rows/cells, which map would skip.
  const matrix: Matrix = Array.from(rows, (row) => Array.from(row ?? [], (c) => excelCell(c, date1904)))

  let filledMergedCells = 0
  for (const range of sheet?.["!merges"] ?? []) {
    const value = matrix[range.s.r]?.[range.s.c] ?? null
    if (value === null) continue
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = (matrix[r] ??= [])
      for (let c = range.s.c; c <= range.e.c; c++) {
        if ((row[c] ?? null) === null) {
          row[c] = value
          filledMergedCells++
        }
      }
    }
  }
  // Rows added above may leave holes; make every row dense.
  const dense = Array.from(matrix, (r) => Array.from(r ?? [], (c) => c ?? null))

  const rowInfo = sheet?.["!rows"] ?? []
  const hiddenRows = dense.filter((r, i) => rowInfo[i]?.hidden === true && r.some((c) => c !== null)).length
  return { matrix: dense, filledMergedCells, hiddenRows }
}

export function sheetMatrix(workbook: WorkBook, name: string): Matrix {
  return readSheet(workbook, name).matrix
}

/** A sheet of a workbook, or a table found in a PDF (then `pages` is its page range). */
export type SheetInfo = { name: string; rows: number; columns: number; pages?: [number, number] }

/**
 * Sheets that contain any value, with their filled size. Hidden sheets (lookup tables, helper
 * calculations) are left out unless no visible sheet has data.
 */
export function listSheets(workbook: WorkBook): SheetInfo[] {
  const all = workbook.SheetNames.flatMap((name, i) => {
    const m = sheetMatrix(workbook, name)
    const filled = m.filter((r) => r.some((c) => c !== null))
    if (filled.length === 0) return []
    const columns = Math.max(...filled.map((r) => r.reduce((last, c, j) => (c !== null ? j + 1 : last), 0)))
    const hidden = Boolean(workbook.Workbook?.Sheets?.[i]?.Hidden)
    return [{ info: { name, rows: filled.length, columns }, hidden }]
  })
  const visible = all.filter((s) => !s.hidden)
  return (visible.length > 0 ? visible : all).map((s) => s.info)
}

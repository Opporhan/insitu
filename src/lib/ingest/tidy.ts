import type { Cell, Matrix } from "./sources"

/** How many top rows are scanned for the header. */
export const HEADER_SCAN_ROWS = 15
/** A row or unnamed column with more than this share of empty cells is a "ghost". */
export const GHOST_EMPTY_SHARE = 0.9

export type TidyReport = {
  /** 1-based row of the detected header in the original sheet; 0 when the data had no header row. */
  headerRow: number
  /** Banner / title / blank rows above the header that were skipped. */
  skippedTopRows: number
  droppedEmptyRows: number
  droppedEmptyColumns: number
  /** First-cell labels of removed summary rows ("TOPLAM", "Genel Toplam"…). */
  droppedTotalRows: string[]
  /** Copies of the header row inside the data (a table printed over several pages). */
  droppedRepeatedHeaders: number
  renamedColumns: { from: string; to: string }[]
  rowCount: number
  columnCount: number
}

export type TidyTable = { header: string[]; rows: Cell[][]; report: TidyReport }

function fold(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
}

const NUMBER_LIKE = /^[-+(]?[₺$€£]?\s*[\d.,\s]+%?\s*(tl|try|usd|eur)?\)?$/i
const DATE_LIKE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/

function isValueLike(cell: string): boolean {
  return NUMBER_LIKE.test(cell) || DATE_LIKE.test(cell)
}

/** A year is a header in pivot layouts ("Ürün | 2023 | 2024 | 2025"). */
const YEAR = /^(19|20)\d{2}$/
const isHeaderText = (cell: string) => YEAR.test(cell) || !isValueLike(cell)

const filled = (row: readonly Cell[]) => row.filter((c) => c !== null).length

/**
 * The header is the row (among the first 15) that is wide, textual and unique and is
 * followed by rows of similar width. Banner rows ("ACME A.Ş. Satış Raporu", "Rapor tarihi: …")
 * are narrow, so they lose. Returns -1 when no row looks like a header (headerless data).
 */
export function detectHeaderRow(matrix: Matrix, width: number): number {
  let best = -1
  let bestScore = 0
  const limit = Math.min(HEADER_SCAN_ROWS, matrix.length)
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? []
    const cells = row.filter((c): c is string => c !== null)
    if (cells.length < Math.min(2, width)) continue
    const textShare = cells.filter(isHeaderText).length / cells.length
    if (textShare < 0.5) continue
    const unique = new Set(cells.map((c) => fold(c))).size / cells.length
    const next = matrix.slice(r + 1, r + 6).filter((x) => filled(x) > 0)
    const avgNext = next.length ? next.reduce((s, x) => s + filled(x), 0) / next.length : 0
    const dataFollows = next.length > 0 && avgNext >= 0.5 * cells.length
    const score = (cells.length / width) * textShare * unique * (dataFollows ? 1 : 0.3)
    if (score > bestScore + 1e-9) {
      best = r
      bestScore = score
    }
  }
  return bestScore >= 0.2 ? best : -1
}

const TOTAL_LABELS = new Set([
  "toplam", "genel toplam", "ara toplam", "toplamlar", "genel ortalama", "ortalama",
  "total", "totals", "grand total", "sub total", "subtotal", "sum", "average", "avg", "mean",
])

/**
 * A summary row: its first filled cell is only a total/average keyword (optionally with ":"),
 * and every other filled cell is a number. A data row that merely starts with such a word —
 * "Total" is also a fuel brand — has other text (city, product) and is kept.
 */
export function isTotalRow(row: readonly Cell[]): string | null {
  const filled = row.filter((c): c is string => c !== null)
  const [first, ...rest] = filled
  if (!first) return null
  const key = fold(first).replace(/[:.\s]+$/, "").replace(/\s+/g, " ")
  if (!TOTAL_LABELS.has(key)) return null
  return rest.every(isValueLike) ? first : null
}

/** DuckDB-safe snake_case name: Turkish letters folded, emoji/brackets/symbols removed. */
export function sanitizeName(raw: string): string {
  const s = fold(raw)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/, "")
  return /^\d/.test(s) ? `kolon_${s}` : s
}

function uniqueNames(raw: readonly (string | null)[]): { names: string[]; renamed: { from: string; to: string }[] } {
  const used = new Set<string>()
  const renamed: { from: string; to: string }[] = []
  const names = raw.map((r, i) => {
    let base = r === null ? "" : sanitizeName(r)
    if (!base) base = `kolon_${i + 1}`
    let name = base
    for (let n = 1; used.has(name); n++) name = `${base}_${n}`
    used.add(name)
    if ((r ?? "") !== name) renamed.push({ from: r ?? "", to: name })
    return name
  })
  return { names, renamed }
}

/**
 * Turns a messy sheet into a clean table: header found, banners/ghost rows/ghost columns
 * and summary rows removed, names made DuckDB-safe. Never invents or alters values.
 */
export function tidyMatrix(input: Matrix): TidyTable {
  // Holes (sparse arrays) become empty rows/cells so every row has the same width.
  const source = Array.from(input, (r) => Array.from(r ?? [], (c) => c ?? null))
  const width = source.reduce((w, r) => Math.max(w, r.reduce((last, c, i) => (c !== null ? i + 1 : last), 0)), 0)
  const matrix = source.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null))

  const headerIndex = detectHeaderRow(matrix, width)
  const headerCells: Cell[] = headerIndex >= 0 ? (matrix[headerIndex] ?? []) : Array.from({ length: width }, () => null)
  let rows = matrix.slice(headerIndex + 1)
  const skippedTopRows = Math.max(0, headerIndex)

  // 1. Fully empty rows.
  let droppedEmptyRows = rows.length
  rows = rows.filter((r) => filled(r) > 0)
  droppedEmptyRows -= rows.length

  // 2. Summary rows (would double count in any aggregate).
  const droppedTotalRows: string[] = []
  rows = rows.filter((r) => {
    const label = isTotalRow(r)
    if (label !== null) droppedTotalRows.push(label)
    return label === null
  })

  // 2b. Repeated header rows (every page of a printed report starts with the header again).
  const headerKey = headerIndex >= 0 ? headerCells.map((c) => (c === null ? "" : fold(c))).join("\u0000") : null
  let droppedRepeatedHeaders = rows.length
  rows = rows.filter((r) => headerKey === null || r.map((c) => (c === null ? "" : fold(c))).join("\u0000") !== headerKey)
  droppedRepeatedHeaders -= rows.length

  // 3. Ghost columns: fully empty, or unnamed and more than 90% empty. A named but sparse
  //    column (e.g. "İade Nedeni") is real data and is kept.
  const keep = headerCells.map((h, c) => {
    const values = rows.filter((r) => r[c] !== null).length
    if (values === 0 && rows.length > 0) return false
    const emptyShare = rows.length ? 1 - values / rows.length : h === null ? 1 : 0
    return !(h === null && emptyShare > GHOST_EMPTY_SHARE)
  })
  const droppedEmptyColumns = keep.filter((k) => !k).length
  rows = rows.map((r) => r.filter((_, c) => keep[c]))
  const keptHeader = headerCells.filter((_, c) => keep[c])

  // 4. Ghost rows: more than 90% of the remaining cells empty and no number or date in them
  //    (a stray note or section label). A sparse row that still carries a value is data.
  const cols = keptHeader.length
  const before = rows.length
  rows = rows.filter(
    (r) => cols === 0 || 1 - filled(r) / cols <= GHOST_EMPTY_SHARE || r.some((c) => c !== null && isValueLike(c)),
  )
  droppedEmptyRows += before - rows.length

  const { names, renamed } = uniqueNames(keptHeader)
  return {
    header: names,
    rows,
    report: {
      headerRow: headerIndex >= 0 ? headerIndex + 1 : 0,
      skippedTopRows,
      droppedEmptyRows,
      droppedEmptyColumns,
      droppedTotalRows,
      droppedRepeatedHeaders,
      renamedColumns: headerIndex >= 0 ? renamed : [],
      rowCount: rows.length,
      columnCount: names.length,
    },
  }
}

function csvField(cell: Cell): string {
  if (cell === null) return ""
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** RFC 4180 CSV (comma, CRLF) for DuckDB, which then reads it with fixed options. */
export function toCsvText(table: TidyTable): string {
  return [table.header.map(csvField).join(","), ...table.rows.map((r) => r.map(csvField).join(","))].join("\r\n")
}

import type { Cell } from "../sources"
import type { CellBox, Glyph, PdfTable } from "./layout"

/**
 * Cross-checks every number and date that OCR read in a scanned table, so a misread digit
 * can never reach a total unnoticed:
 * 1. two engines (Turkish+English and Turkish) agree on the value → accepted;
 * 2. otherwise the cell is read again by two digits-only engines and a value that at least two
 *    of the readings agree on wins;
 * 3. no agreement → the cell is marked "(?)", which keeps its column from being converted to
 *    numbers, so no sum or average is ever computed from it.
 */

export type Reading = { text: string; conf: number }
/** Reads the given cells again (digits only, by independent engines); the readings of each box, in order. */
export type Reread = (boxes: readonly CellBox[]) => Promise<Reading[][]>
export type VerifyStats = { checkedCells: number; correctedCells: number; uncertainCells: number }

export const UNCERTAIN_MARK = "(?)"

const NUMBER = /^[-+(]?[₺$€£]?\d[\d.,]*%?(₺|tl|try|usd|eur|\$|€)?\)?-?$/i
const DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(\d{1,2}:\d{2}(:\d{2})?)?$/
/** Compared without spaces: "1.250, 50" and "1.250,50" are the same reading. */
const compact = (s: string) => s.replace(/\s+/g, "")
const isValue = (s: string) => NUMBER.test(compact(s)) || DATE.test(compact(s))

/**
 * Letters OCR confuses with digits. In a number column a token made only of digits and these
 * ("l2", "O", "I") is read as digits for the vote; it still needs a second reading to agree.
 */
const CONFUSABLE: Record<string, string> = { O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2", g: "9" }
function digitize(s: string): string {
  const t = compact(s)
  return /^[\d.,:/-]*[OoDIl|iSsBZzg][\dOoDIl|iSsBZzg.,:/-]*$/.test(t) ? t.replace(/[OoDIl|iSsBZzg]/g, (c) => CONFUSABLE[c] ?? c) : t
}

/** A short token in a number column is a misread value ("ak" for 1), not a label. */
const looksMisread = (s: string) => compact(s).length <= 4 || /\d/.test(s)

function altText(box: CellBox, alt: readonly Glyph[]): string | null {
  const pad = 1
  const words = alt
    .filter((g) => {
      const cx = (g.x0 + g.x1) / 2
      const cy = g.y - g.h / 2
      return cx >= box.x0 - pad && cx <= box.x1 + pad && cy >= box.y0 - pad && cy <= box.y1 + pad
    })
    .sort((a, b) => a.x0 - b.x0)
  return words.length ? words.map((g) => g.text).join(" ") : null
}

/** Value columns: at least 3 filled cells, 60% of them numbers or dates. */
function valueColumns(matrix: readonly Cell[][]): number[] {
  const width = Math.max(0, ...matrix.map((r) => r.length))
  const out: number[] = []
  for (let c = 0; c < width; c++) {
    const filled = matrix.map((r) => r[c]).filter((v): v is string => v !== null && v !== undefined)
    if (filled.length >= 3 && filled.filter((v) => isValue(digitize(v))).length >= 0.6 * filled.length) out.push(c)
  }
  return out
}

/** Header, banner and label rows: no value at all in the value columns. They are not checked. */
function isTextRow(row: readonly Cell[], columns: readonly number[]): boolean {
  return !columns.some((c) => {
    const v = row[c]
    return v !== null && v !== undefined && isValue(digitize(v))
  })
}

export async function verifyOcrTable(
  table: PdfTable,
  altByPage: ReadonlyMap<number, readonly Glyph[]>,
  reread: Reread,
): Promise<{ table: PdfTable; stats: VerifyStats }> {
  const matrix = table.matrix.map((r) => [...r])
  const columns = valueColumns(matrix)
  type Pending = { r: number; c: number; box: CellBox; first: string; second: string | null }
  const pending: Pending[] = []
  let checkedCells = 0

  matrix.forEach((row, r) => {
    if (isTextRow(row, columns)) return
    for (const c of columns) {
      const cell = row[c]
      const box = table.boxes[r]?.[c]
      if (cell === null || cell === undefined || !box) continue
      if (!isValue(cell) && !looksMisread(cell)) continue
      checkedCells++
      const second = altText(box, altByPage.get(box.page) ?? [])
      if (isValue(cell) && second !== null && digitize(second) === compact(cell)) continue
      pending.push({ r, c, box, first: cell, second })
    }
  })

  const third = pending.length > 0 ? await reread(pending.map((p) => p.box)) : []
  let correctedCells = 0
  let uncertainCells = 0
  pending.forEach((p, i) => {
    const readings = [p.first, p.second, ...(third[i] ?? []).map((r) => r.text)]
      .filter((t): t is string => t !== null)
      .map(digitize)
      .filter(isValue)
    const agreed = readings.find((t, k) => readings.some((u, l) => l !== k && compact(u) === compact(t)))
    const row = matrix[p.r]
    if (!row) return
    if (agreed !== undefined) {
      if (compact(agreed) !== compact(p.first)) correctedCells++
      row[p.c] = compact(agreed) === compact(p.first) ? p.first : compact(agreed)
    } else {
      uncertainCells++
      row[p.c] = `${p.first} ${UNCERTAIN_MARK}`
    }
  })
  return { table: { ...table, matrix }, stats: { checkedCells, correctedCells, uncertainCells } }
}

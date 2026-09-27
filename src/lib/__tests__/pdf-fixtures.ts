import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib"

/** Real PDFs for tests, written the way report generators and "print to PDF" produce them. */

const require = createRequire(import.meta.url)
const FONT = readFileSync(require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"))

export type Align = "left" | "right"
export type TableSpec = {
  columns: { title: string; width: number; align?: Align }[]
  rows: string[][]
  /** Draw cell borders (lattice) or not (whitespace-aligned). */
  ruled?: boolean
  /** Font size and row height. */
  size?: number
  rowHeight?: number
}

type Doc = { doc: PDFDocument; font: PDFFont }

export async function newDoc(): Promise<Doc> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  return { doc, font: await doc.embedFont(FONT, { subset: true }) }
}

const A4: [number, number] = [595, 842]

export function text(page: PDFPage, font: PDFFont, s: string, x: number, top: number, size = 10) {
  page.drawText(s, { x, y: page.getHeight() - top, size, font })
}

/**
 * Draws a table starting at `top` (distance from the page top). Wrapped cells are written
 * as "line one\nline two". Continues on new pages when it runs out of space, repeating the
 * header, and calls `decorate` on every page (headers/footers). Returns the last page and y.
 */
export function drawTable(
  { doc, font }: Doc,
  spec: TableSpec,
  opts: { page?: PDFPage; top?: number; x?: number; decorate?: (page: PDFPage, n: number) => void; bottom?: number } = {},
): { page: PDFPage; top: number } {
  const size = spec.size ?? 9
  const rowHeight = spec.rowHeight ?? 16
  const x0 = opts.x ?? 40
  const bottom = opts.bottom ?? 60
  let pageNo = doc.getPageCount()
  let page = opts.page ?? doc.addPage(A4)
  if (!opts.page) opts.decorate?.(page, ++pageNo)
  let top = opts.top ?? 60
  const width = spec.columns.reduce((s, c) => s + c.width, 0)

  const drawRow = (cells: string[], bold = false) => {
    const lines = Math.max(...cells.map((c) => c.split("\n").length))
    const height = rowHeight + (lines - 1) * (size + 2)
    let x = x0
    spec.columns.forEach((col, i) => {
      const parts = (cells[i] ?? "").split("\n")
      parts.forEach((part, k) => {
        const w = font.widthOfTextAtSize(part, size)
        const px = col.align === "right" ? x + col.width - 4 - w : x + 4
        page.drawText(part, { x: px, y: page.getHeight() - top - size - 3 - k * (size + 2), size, font, color: bold ? rgb(0, 0, 0) : rgb(0.1, 0.1, 0.1) })
      })
      if (spec.ruled) {
        page.drawRectangle({ x, y: page.getHeight() - top - height, width: col.width, height, borderWidth: 0.5, borderColor: rgb(0, 0, 0) })
      }
      x += col.width
    })
    if (!spec.ruled && bold) {
      page.drawLine({ start: { x: x0, y: page.getHeight() - top - height }, end: { x: x0 + width, y: page.getHeight() - top - height }, thickness: 0.5 })
    }
    top += height
  }

  const header = spec.columns.map((c) => c.title)
  drawRow(header, true)
  for (const row of spec.rows) {
    const lines = Math.max(...row.map((c) => c.split("\n").length))
    if (top + rowHeight + (lines - 1) * (size + 2) > page.getHeight() - bottom) {
      page = doc.addPage(A4)
      opts.decorate?.(page, ++pageNo)
      top = 60
      drawRow(header, true)
    }
    drawRow(row)
  }
  return { page, top }
}

export const trMoney = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

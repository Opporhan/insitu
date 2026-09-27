import type { Cell, Matrix } from "../sources"

/**
 * Table reconstruction from positioned text. The same code handles a PDF's text layer and
 * OCR output, so both are described with page coordinates in points, y growing downwards.
 */

/** A run of text at a position. `y` is the baseline, `h` the font size, `conf` the OCR confidence (0–100). */
export type Glyph = { text: string; x0: number; x1: number; y: number; h: number; conf?: number }
/** A drawn line segment (table border). Rectangles are split into their four edges. */
export type Rule = { x0: number; y0: number; x1: number; y1: number }
export type PageData = {
  page: number
  width: number
  height: number
  glyphs: Glyph[]
  rules: Rule[]
  ocr: boolean
  /** OCR only: the second (Turkish model) reading of the page, and the deskew angle used. */
  alt?: Glyph[]
  angle?: number
}

/** Where a cell's text sits on its page (points), and the lowest OCR confidence of its words. */
export type CellBox = { page: number; x0: number; x1: number; y0: number; y1: number; conf: number }
/** `boxes` has the same shape as `matrix` (null for empty cells). */
export type PdfTable = { matrix: Matrix; boxes: (CellBox | null)[][]; pages: [number, number]; ocr: boolean }
export type LayoutStats = { droppedPageFurniture: number; mergedWrappedRows: number }

/** Text pieces of one visual line that sit closer than this (× font size) are one cell. */
const WORD_GAP = 0.6
/** Gap between two columns must be at least this many points wide. */
const MIN_COLUMN_GAP = 2.5
/** Share of the page at the top and bottom where page headers/footers live. */
const FURNITURE_ZONE = 0.12

type Segment = { text: string; x0: number; x1: number; conf: number }
type Line = { page: number; y: number; h: number; segments: Segment[]; x0: number; x1: number }
type Region = { lines: Line[]; rules: Rule[]; ocr: boolean }

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2
}

const NUMERIC = /^[-+(]?[₺$€£]?\s*\d[\d.,\s]*%?\s*(₺|tl|try|usd|eur|\$|€)?\)?-?$/i
const DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/
const isValue = (s: string) => NUMERIC.test(s) || DATE.test(s)

/**
 * Some generators align columns with runs of spaces inside one text item
 * ("Kadıköy      1.250,50"). Split those runs, estimating x from the character share.
 */
function splitSpaced(g: Glyph): Glyph[] {
  const text = g.text.replace(/\s+$/, "")
  if (!/\S\s{2,}\S/.test(text)) return [{ ...g, text: text.trim() }]
  const perChar = (g.x1 - g.x0) / Math.max(1, g.text.length)
  const out: Glyph[] = []
  const re = /\S+(?: \S+)*/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ ...g, text: m[0], x0: g.x0 + m.index * perChar, x1: g.x0 + (m.index + m[0].length) * perChar })
  }
  return out
}

/** Glyphs → visual lines (by baseline) → segments (by horizontal gap). */
export function buildLines(page: PageData): Line[] {
  const glyphs = page.glyphs
    .flatMap(splitSpaced)
    .filter((g) => g.text !== "" && g.h > 0 && !/^[|_¦]+$/.test(g.text))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const groups: Glyph[][] = []
  for (const g of glyphs) {
    const last = groups[groups.length - 1]
    const ref = last?.[0]
    if (last && ref && Math.abs(g.y - ref.y) <= 0.5 * Math.min(g.h, ref.h)) last.push(g)
    else groups.push([g])
  }
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => a.x0 - b.x0)
    const h = median(sorted.map((g) => g.h))
    const segments: Segment[] = []
    for (const g of sorted) {
      const prev = segments[segments.length - 1]
      if (prev && g.x0 - prev.x1 <= WORD_GAP * h) {
        const glue = g.x0 - prev.x1 > 0.1 * h ? " " : ""
        prev.text = `${prev.text}${glue}${g.text}`
        prev.x1 = Math.max(prev.x1, g.x1)
        prev.conf = Math.min(prev.conf, g.conf ?? 100)
      } else segments.push({ text: g.text, x0: g.x0, x1: g.x1, conf: g.conf ?? 100 })
    }
    return {
      page: page.page,
      y: median(sorted.map((g) => g.y)),
      h,
      segments,
      x0: segments[0]?.x0 ?? 0,
      x1: Math.max(...segments.map((s) => s.x1)),
    }
  })
}

const lineText = (l: Line) => l.segments.map((s) => s.text).join(" ")
const furnitureKey = (l: Line) => lineText(l).toLocaleLowerCase("tr").replace(/\d+/g, "#").replace(/\s+/g, " ")
const PAGE_NUMBER = /^(sayfa|page|s\.|p\.)?\s*#\s*((\/|of|\/ ?|-)\s*#)?$|^#\s*(\/|of)\s*#$|^-\s*#\s*-$/

/**
 * Page headers and footers: lines in the top/bottom zone that repeat on at least half of
 * the pages (digits ignored, so "Sayfa 1/3" and "Sayfa 2/3" match), or page numbers.
 */
export function dropPageFurniture(pages: readonly PageData[], lines: readonly Line[][]): { lines: Line[][]; dropped: number } {
  const inZone = (l: Line) => {
    const page = pages.find((p) => p.page === l.page)
    const height = page?.height ?? 0
    return l.y < height * FURNITURE_ZONE || l.y > height * (1 - FURNITURE_ZONE)
  }
  // The header row of a table repeats at the top of every page too, but it is followed by
  // more multi-cell lines; page furniture is not.
  const tableTops = new Set<Line>()
  for (const pageLines of lines) {
    pageLines.forEach((l, i) => {
      const next = pageLines[i + 1]
      if (l.segments.length >= 2 && next && next.segments.length >= 2 && next.y - l.y <= 3 * Math.max(l.h, next.h)) tableTops.add(l)
    })
  }
  const candidate = (l: Line) => inZone(l) && !tableTops.has(l)
  const pagesByKey = new Map<string, Set<number>>()
  for (const l of lines.flat()) {
    if (!candidate(l)) continue
    const key = furnitureKey(l)
    pagesByKey.set(key, (pagesByKey.get(key) ?? new Set()).add(l.page))
  }
  const minPages = Math.max(2, Math.ceil(pages.length / 2))
  let dropped = 0
  const kept = lines.map((pageLines) =>
    pageLines.filter((l) => {
      if (!candidate(l)) return true
      const key = furnitureKey(l)
      const repeated = pages.length >= 2 && (pagesByKey.get(key)?.size ?? 0) >= minPages
      if (repeated || PAGE_NUMBER.test(key)) {
        dropped++
        return false
      }
      return true
    }),
  )
  return { lines: kept, dropped }
}

/** Running text: one long segment. Breaks table regions and is never part of a table. */
function isProse(l: Line, pageWidth: number): boolean {
  return l.segments.length === 1 && l.x1 - l.x0 > 0.45 * pageWidth && !isValue(l.segments[0]?.text ?? "")
}

/**
 * Splits a page into table regions: runs of lines cut by prose, by large vertical gaps and
 * by a section title (a single cell after a clearly bigger gap). A region needs ≥ 2
 * multi-cell lines.
 */
function pageRegions(page: PageData, lines: readonly Line[]): Region[] {
  const pitch = median(lines.slice(1).map((l, i) => l.y - (lines[i]?.y ?? 0))) || 12
  const regions: Region[] = []
  let current: Line[] = []
  const flush = () => {
    if (current.filter((l) => l.segments.length >= 2).length >= 2) regions.push({ lines: current, rules: page.rules, ocr: page.ocr })
    current = []
  }
  for (const l of lines) {
    if (isProse(l, page.width)) {
      flush()
      continue
    }
    const prev = current[current.length - 1]
    const gap = prev ? l.y - prev.y : 0
    if (prev && (gap > 3.5 * Math.max(prev.h, l.h) || (gap > 1.8 * pitch && l.segments.length === 1))) flush()
    current.push(l)
  }
  flush()
  return regions
}

const extent = (r: Region) => {
  const multi = r.lines.filter((l) => l.segments.length >= 2)
  return { x0: Math.min(...multi.map((l) => l.x0)), x1: Math.max(...multi.map((l) => l.x1)) }
}

/**
 * A table split across pages: the first region of a page continues the last region of the
 * previous page when both span the same horizontal range.
 */
function linkAcrossPages(regions: readonly Region[][]): Region[] {
  const out: Region[] = []
  let tailPage = -1 // page index whose last region is out's last element
  regions.forEach((pageRegions, i) => {
    pageRegions.forEach((r, j) => {
      const prev = out[out.length - 1]
      if (j === 0 && prev && tailPage === i - 1 && overlap(extent(prev), extent(r)) >= 0.85) {
        out[out.length - 1] = { lines: [...prev.lines, ...r.lines], rules: [...prev.rules, ...r.rules], ocr: prev.ocr || r.ocr }
      } else out.push(r)
    })
    if (pageRegions.length > 0) tailPage = i
  })
  return out
}

function overlap(a: { x0: number; x1: number }, b: { x0: number; x1: number }): number {
  const inter = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  return inter <= 0 ? 0 : inter / Math.max(a.x1 - a.x0, b.x1 - b.x0)
}

/** Vertical borders that run through most of the region (lattice tables). */
function ruledBoundaries(r: Region): number[] {
  const pagesInRegion = new Set(r.lines.map((l) => l.page))
  if (pagesInRegion.size !== 1) return []
  const top = Math.min(...r.lines.map((l) => l.y - l.h))
  const bottom = Math.max(...r.lines.map((l) => l.y))
  const height = bottom - top
  const { x0, x1 } = extent(r)
  const xs = r.rules
    .filter((rule) => Math.abs(rule.x1 - rule.x0) < 1.5)
    .filter((rule) => Math.min(bottom, Math.max(rule.y0, rule.y1)) - Math.max(top, Math.min(rule.y0, rule.y1)) >= 0.5 * height)
    .map((rule) => (rule.x0 + rule.x1) / 2)
    .filter((x) => x > x0 + 1 && x < x1 - 1)
    .sort((a, b) => a - b)
  const clustered: number[] = []
  for (const x of xs) if (clustered.length === 0 || x - (clustered[clustered.length - 1] ?? 0) > 2) clustered.push(x)
  return clustered
}

/**
 * Column boundaries from whitespace: x positions no multi-cell line covers. A few
 * exceptions are allowed so one wide cell (a spanning title) does not merge two columns.
 */
function whitespaceBoundaries(r: Region): number[] {
  // Lines above the first full-width line (the header) are banners ("Rapor tarihi: … Hazırlayan: …").
  const widest = Math.max(...r.lines.map((l) => l.segments.length))
  const header = r.lines.findIndex((l) => l.segments.length >= 0.7 * widest)
  const multi = r.lines.slice(Math.max(0, header)).filter((l) => l.segments.length >= 2)
  const { x0, x1 } = extent(r)
  const width = Math.ceil(x1 - x0) + 1
  const cover = new Array<number>(width).fill(0)
  for (const l of multi) {
    for (const s of l.segments) {
      for (let x = Math.floor(s.x0 - x0); x < Math.ceil(s.x1 - x0); x++) if (x >= 0 && x < width) cover[x] = (cover[x] ?? 0) + 1
    }
  }
  const allowed = Math.floor(multi.length * 0.08)
  const bounds: number[] = []
  let start = -1
  for (let x = 0; x <= width; x++) {
    const free = x < width && (cover[x] ?? 0) <= allowed
    if (free && start < 0) start = x
    if (!free && start >= 0) {
      if (x - start >= MIN_COLUMN_GAP && start > 0 && x < width) bounds.push(x0 + (start + x) / 2)
      start = -1
    }
  }
  return bounds
}

function columnOf(bounds: readonly number[], s: Segment): number {
  const center = (s.x0 + s.x1) / 2
  let c = 0
  while (c < bounds.length && center > (bounds[c] ?? Infinity)) c++
  return c
}

/**
 * Wrapped cell text: a line with no numbers/dates, fewer than half of the columns filled,
 * close below the previous row, whose filled cells extend text cells of that row.
 */
function isContinuation(row: readonly Cell[], prev: readonly Cell[] | undefined, gap: number, pitch: number): boolean {
  if (!prev) return false
  const filled = row.map((c, i) => [c, i] as const).filter(([c]) => c !== null)
  if (filled.length === 0 || filled.length * 2 >= row.length) return false
  if (filled.some(([c]) => isValue(c ?? ""))) return false
  if (gap > 1.5 * pitch) return false
  return filled.every(([, i]) => prev[i] !== null && prev[i] !== undefined && !isValue(prev[i] ?? ""))
}

function extend(box: CellBox | null, add: CellBox | null): CellBox | null {
  if (!box || !add || box.page !== add.page) return box ?? add
  return {
    page: box.page,
    x0: Math.min(box.x0, add.x0),
    x1: Math.max(box.x1, add.x1),
    y0: Math.min(box.y0, add.y0),
    y1: Math.max(box.y1, add.y1),
    conf: Math.min(box.conf, add.conf),
  }
}

type Row = { cells: Cell[]; boxes: (CellBox | null)[]; line: Line }

function regionToMatrix(r: Region): { matrix: Matrix; boxes: (CellBox | null)[][]; merged: number } {
  const ruled = ruledBoundaries(r)
  const bounds = ruled.length > 0 ? ruled : whitespaceBoundaries(r)
  const columns = bounds.length + 1
  const rows: Row[] = r.lines.map((line) => {
    const cells: Cell[] = new Array<Cell>(columns).fill(null)
    const boxes: (CellBox | null)[] = new Array<CellBox | null>(columns).fill(null)
    for (const s of line.segments) {
      const c = columnOf(bounds, s)
      cells[c] = cells[c] === null ? s.text : `${cells[c]} ${s.text}`
      const box = { page: line.page, x0: s.x0, x1: s.x1, y0: line.y - line.h, y1: line.y + 0.3 * line.h, conf: s.conf }
      boxes[c] = extend(boxes[c] ?? null, box)
    }
    return { cells, boxes, line }
  })

  const gaps = rows.slice(1).flatMap((row, i) => {
    const prev = rows[i]
    return prev && prev.line.page === row.line.page ? [row.line.y - prev.line.y] : []
  })
  const pitch = median(gaps) || 12
  const out: Row[] = []
  let merged = 0
  for (const row of rows) {
    const prev = out[out.length - 1]
    const gap = prev && prev.line.page === row.line.page ? row.line.y - prev.line.y : Infinity
    if (prev && isContinuation(row.cells, prev.cells, gap, pitch)) {
      prev.cells = prev.cells.map((c, i) => (row.cells[i] ? `${c} ${row.cells[i]}` : c))
      prev.boxes = prev.boxes.map((b, i) => extend(b, row.boxes[i] ?? null))
      prev.line = row.line
      merged++
    } else out.push({ cells: [...row.cells], boxes: [...row.boxes], line: row.line })
  }
  return { matrix: out.map((row) => row.cells), boxes: out.map((row) => row.boxes), merged }
}

/** Pages with positioned text → tables, in reading order. */
export function extractTables(pages: readonly PageData[]): { tables: PdfTable[]; stats: LayoutStats } {
  const sorted = [...pages].sort((a, b) => a.page - b.page)
  const { lines, dropped } = dropPageFurniture(sorted, sorted.map(buildLines))
  const regions = linkAcrossPages(sorted.map((p, i) => pageRegions(p, lines[i] ?? [])))
  let mergedWrappedRows = 0
  const tables = regions.map((r) => {
    const { matrix, boxes, merged } = regionToMatrix(r)
    mergedWrappedRows += merged
    const pageNumbers = r.lines.map((l) => l.page)
    return { matrix, boxes, pages: [Math.min(...pageNumbers), Math.max(...pageNumbers)] as [number, number], ocr: r.ocr }
  })
  return { tables, stats: { droppedPageFurniture: dropped, mergedWrappedRows } }
}

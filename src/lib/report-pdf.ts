import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib"

/**
 * A multi-page PDF report built in the browser: a cover with contents, then one page per
 * analysis (more for long tables) with its title, question, chart image, insight and note as
 * real, selectable text. Loaded only when the user downloads a report.
 */

/** `width`/`height` are the captured element's CSS size (the PNG itself is sharper). */
export type ReportImage = { png: Uint8Array; width: number; height: number }
export type ReportEntry = {
  title: string
  question: string
  insight: string
  notes: string[]
  images: ReportImage[]
}
export type ReportTexts = {
  coverTitle: string
  coverSubtitle: string
  contents: string
  footer: string
  page: (n: number, total: number) => string
  continued: string
  pageRef: (n: number) => string
}
export type ReportFonts = { regular: ArrayBuffer; bold: ArrayBuffer }

// A4 landscape: charts are wide.
const W = 842
const H = 595
const M = 40
const INK = rgb(0.04, 0.04, 0.05)
const MUTED = rgb(0.4, 0.4, 0.44)
const RULE = rgb(0.88, 0.88, 0.9)
const ACCENT = rgb(0.02, 0.47, 0.34)

/** Characters the embedded font lacks get a readable stand-in instead of an empty box. */
const FALLBACKS: Record<string, string> = { "→": "–", "←": "–", "−": "-", "✓": "+", "…": "..." }

function safeText(text: string, font: PDFFont): string {
  const has = new Set(font.getCharacterSet())
  return [...text.replace(/\s+/g, " ")]
    .map((c) => (has.has(c.codePointAt(0) ?? 0) ? c : (FALLBACKS[c] ?? (has.has(63) ? "?" : ""))))
    .join("")
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  // A single word wider than the line is cut rather than drawn off the page.
  return lines.map((l) => {
    let s = l
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > width) s = s.slice(0, -1)
    return s
  })
}

type Fonts = { regular: PDFFont; bold: PDFFont }

function drawLines(page: PDFPage, lines: readonly string[], x: number, top: number, size: number, font: PDFFont, color = INK, leading = 1.35): number {
  let y = top
  for (const line of lines) {
    y -= size * leading
    page.drawText(line, { x, y, size, font, color })
  }
  return y
}

export async function buildReportPdf(entries: readonly ReportEntry[], texts: ReportTexts, fontData: ReportFonts, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts: Fonts = {
    regular: await doc.embedFont(fontData.regular, { subset: true }),
    bold: await doc.embedFont(fontData.bold, { subset: true }),
  }
  const t = (s: string, bold = false) => safeText(s, bold ? fonts.bold : fonts.regular)
  doc.setTitle(t(title))
  doc.setCreator("Insitu")
  doc.setProducer("Insitu")

  // Page numbers: the cover is page 1; each image of an entry takes one page.
  const starts: number[] = []
  let next = 2
  for (const e of entries) {
    starts.push(next)
    next += Math.max(1, e.images.length)
  }
  const total = next - 1
  const footer = (page: PDFPage, n: number) => {
    page.drawLine({ start: { x: M, y: M - 8 }, end: { x: W - M, y: M - 8 }, thickness: 0.5, color: RULE })
    page.drawText(t(texts.footer), { x: M, y: M - 22, size: 8, font: fonts.regular, color: MUTED })
    const label = t(texts.page(n, total))
    page.drawText(label, { x: W - M - fonts.regular.widthOfTextAtSize(label, 8), y: M - 22, size: 8, font: fonts.regular, color: MUTED })
  }

  // Cover.
  const cover = doc.addPage([W, H])
  cover.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ACCENT })
  let y = drawLines(cover, wrap(t(texts.coverTitle, true), fonts.bold, 26, W - 2 * M), M, H - 70, 26, fonts.bold)
  y = drawLines(cover, wrap(t(texts.coverSubtitle), fonts.regular, 12, W - 2 * M), M, y - 4, 12, fonts.regular, MUTED)
  y = drawLines(cover, [t(texts.contents, true)], M, y - 24, 14, fonts.bold)
  entries.forEach((e, i) => {
    const ref = t(texts.pageRef(starts[i] ?? 0))
    const refWidth = fonts.regular.widthOfTextAtSize(ref, 11)
    const lines = wrap(t(`${i + 1}. ${e.title}`), fonts.regular, 11, W - 2 * M - refWidth - 16)
    if (y - lines.length * 15 < M + 20) return // contents longer than a page: the rest are still in the report
    // Same baseline as the entry's first line (drawn 2 pt lower by drawLines below).
    cover.drawText(ref, { x: W - M - refWidth, y: y - 2 - 11 * 1.35, size: 11, font: fonts.regular, color: MUTED })
    y = drawLines(cover, lines, M, y - 2, 11, fonts.regular)
  })
  footer(cover, 1)

  // One page per image.
  for (const [i, e] of entries.entries()) {
    const images = e.images.length > 0 ? e.images : [null]
    for (const [k, image] of images.entries()) {
      const page = doc.addPage([W, H])
      const n = (starts[i] ?? 0) + k
      let top = drawLines(page, wrap(t(k > 0 ? `${e.title} ${texts.continued}` : e.title, true), fonts.bold, 16, W - 2 * M), M, H - M + 6, 16, fonts.bold)
      top = drawLines(page, wrap(t(e.question), fonts.regular, 10, W - 2 * M).slice(0, 2), M, top, 10, fonts.regular, MUTED)
      top -= 10

      // Insight and notes under the image of the last page of this entry.
      const last = k === images.length - 1
      const insightLines = last ? wrap(t(e.insight), fonts.regular, 11, W - 2 * M) : []
      const noteLines = last ? e.notes.flatMap((note) => wrap(t(note), fonts.regular, 9, W - 2 * M)) : []
      const textHeight = insightLines.length * 11 * 1.35 + noteLines.length * 9 * 1.35 + (last ? 16 : 0)
      const bottom = M + textHeight + 6

      if (image) {
        const png = await doc.embedPng(image.png)
        // Fit the free area; never enlarge beyond 0.8 pt per CSS pixel (keeps text sizes natural).
        const scale = Math.min((W - 2 * M) / image.width, (top - bottom) / image.height, 0.8)
        const w = image.width * scale
        const h = image.height * scale
        page.drawImage(png, { x: (W - w) / 2, y: top - h, width: w, height: h })
        top -= h + 14
      }
      if (last) {
        top = drawLines(page, insightLines, M, top, 11, fonts.regular)
        drawLines(page, noteLines, M, top - 4, 9, fonts.regular, MUTED)
      }
      footer(page, n)
    }
  }
  return doc.save()
}

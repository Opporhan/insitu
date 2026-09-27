import { needsOcr, openPdf, readPage, renderPage } from "./extract"
import { extractTables, type CellBox, type Glyph, type PageData, type PdfTable } from "./layout"
import type { PageReader } from "./ocr"
import { verifyOcrTable, type Reading } from "./verify"

export type { PdfTable } from "./layout"

/** Pages read at most (text layer). */
export const MAX_PDF_PAGES = 500
/** Scanned pages recognised at most; OCR costs a few seconds per page. */
export const MAX_OCR_PAGES = 50
/** Render scale for OCR: 300 DPI / 72. */
const OCR_SCALE = 300 / 72

export type PdfProgress = { step: "read" | "ocr" | "verify"; page: number; pages: number }

export type PdfResult = {
  tables: PdfTable[]
  pages: number
  ocrPages: number
  skippedOcrPages: number
  lowConfidenceWords: number
  droppedPageFurniture: number
  mergedWrappedRows: number
  /** Scanned numbers/dates cross-checked, fixed by a majority of readings, or left marked "(?)". */
  checkedCells: number
  correctedCells: number
  uncertainCells: number
}

/** PDF bytes → tables. Text-layer pages are read directly; scanned pages go through OCR. */
export async function readPdf(data: ArrayBuffer, onProgress: (p: PdfProgress) => void = () => {}): Promise<PdfResult> {
  const pdf = await openPdf(data)
  let reader: PageReader | null = null
  try {
    const total = Math.min(pdf.numPages, MAX_PDF_PAGES)
    const pages: PageData[] = []
    for (let n = 1; n <= total; n++) {
      onProgress({ step: "read", page: n, pages: total })
      pages.push(await readPage(pdf, n))
    }

    const scanned = pages.filter(needsOcr)
    const toRecognise = scanned.slice(0, MAX_OCR_PAGES)
    let lowConfidenceWords = 0
    if (toRecognise.length > 0) {
      if (typeof OffscreenCanvas === "undefined") throw new Error("pdf-scanned")
      const { PageReader } = await import("./ocr")
      reader = new PageReader()
      for (const [i, page] of toRecognise.entries()) {
        onProgress({ step: "ocr", page: i + 1, pages: toRecognise.length })
        const result = await reader.read(await renderBlob(pdf, page.page), OCR_SCALE)
        page.glyphs = result.glyphs
        page.alt = result.alt
        page.angle = result.angle
        page.rules = []
        page.ocr = true
        lowConfidenceWords += result.lowConfidenceWords
      }
    }

    const { tables, stats } = extractTables(pages.filter((p) => !needsOcr(p) || p.ocr))

    // Scanned tables: every number and date is cross-checked before anyone can sum it.
    let checkedCells = 0
    let correctedCells = 0
    let uncertainCells = 0
    const verified: PdfTable[] = []
    const ocrReader = reader
    for (const table of tables) {
      if (!table.ocr || !ocrReader) {
        verified.push(table)
        continue
      }
      const altByPage = new Map<number, Glyph[]>(pages.flatMap((p) => (p.alt ? [[p.page, p.alt] as [number, Glyph[]]] : [])))
      const result = await verifyOcrTable(table, altByPage, async (boxes) => {
        const out: Reading[][] = boxes.map(() => [])
        const byPage = new Map<number, number[]>()
        boxes.forEach((b, i) => byPage.set(b.page, [...(byPage.get(b.page) ?? []), i]))
        let done = 0
        for (const [pageNumber, indexes] of byPage) {
          onProgress({ step: "verify", page: ++done, pages: byPage.size })
          const angle = pages.find((p) => p.page === pageNumber)?.angle ?? 0
          const readings = await ocrReader.readDigits(
            await renderBlob(pdf, pageNumber),
            angle,
            indexes.map((i) => toPixels(boxes[i] as CellBox)),
          )
          indexes.forEach((i, k) => (out[i] = readings[k] ?? []))
        }
        return out
      })
      verified.push(result.table)
      checkedCells += result.stats.checkedCells
      correctedCells += result.stats.correctedCells
      uncertainCells += result.stats.uncertainCells
    }

    return {
      tables: verified,
      pages: pdf.numPages,
      ocrPages: toRecognise.length,
      skippedOcrPages: scanned.length - toRecognise.length,
      lowConfidenceWords,
      ...stats,
      checkedCells,
      correctedCells,
      uncertainCells,
    }
  } finally {
    await reader?.close()
    await pdf.loadingTask.destroy()
  }
}

/** The same rendering every time, so a re-read hits exactly the pixels of the first reading. */
async function renderBlob(pdf: Awaited<ReturnType<typeof openPdf>>, pageNumber: number): Promise<Blob> {
  const canvas = await renderPage(pdf, pageNumber, OCR_SCALE)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  canvas.width = canvas.height = 0
  return blob
}

function toPixels(box: CellBox) {
  const padX = 2
  const padY = 1.5
  const left = Math.max(0, Math.floor((box.x0 - padX) * OCR_SCALE))
  const top = Math.max(0, Math.floor((box.y0 - padY) * OCR_SCALE))
  return {
    left,
    top,
    width: Math.ceil((box.x1 - box.x0 + 2 * padX) * OCR_SCALE),
    height: Math.ceil((box.y1 - box.y0 + 2 * padY) * OCR_SCALE),
  }
}

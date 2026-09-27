import { needsOcr, openPdf, readPage, renderPage } from "./extract"
import { extractTables, type PageData, type PdfTable } from "./layout"

export type { PdfTable } from "./layout"

/** Pages read at most (text layer). */
export const MAX_PDF_PAGES = 500
/** Scanned pages recognised at most; OCR costs a few seconds per page. */
export const MAX_OCR_PAGES = 50
/** Render scale for OCR: 300 DPI / 72. */
const OCR_SCALE = 300 / 72

export type PdfProgress = { step: "read" | "ocr"; page: number; pages: number }

export type PdfResult = {
  tables: PdfTable[]
  pages: number
  ocrPages: number
  skippedOcrPages: number
  lowConfidenceWords: number
  droppedPageFurniture: number
  mergedWrappedRows: number
}

/** PDF bytes → tables. Text-layer pages are read directly; scanned pages go through OCR. */
export async function readPdf(data: ArrayBuffer, onProgress: (p: PdfProgress) => void = () => {}): Promise<PdfResult> {
  const pdf = await openPdf(data)
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
      const reader = new PageReader()
      try {
        for (const [i, page] of toRecognise.entries()) {
          onProgress({ step: "ocr", page: i + 1, pages: toRecognise.length })
          const canvas = await renderPage(pdf, page.page, OCR_SCALE)
          const result = await reader.read(await canvas.convertToBlob({ type: "image/png" }), OCR_SCALE)
          canvas.width = canvas.height = 0
          page.glyphs = result.glyphs
          page.rules = []
          page.ocr = true
          lowConfidenceWords += result.lowConfidenceWords
        }
      } finally {
        await reader.close()
      }
    }

    const { tables, stats } = extractTables(pages.filter((p) => !needsOcr(p) || p.ocr))
    return {
      tables,
      pages: pdf.numPages,
      ocrPages: toRecognise.length,
      skippedOcrPages: scanned.length - toRecognise.length,
      lowConfidenceWords,
      ...stats,
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

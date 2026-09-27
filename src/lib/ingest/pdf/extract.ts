import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { Glyph, PageData, Rule } from "./layout"

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")

let loading: Promise<PdfJs> | null = null

/**
 * pdf.js, loaded only when a PDF is opened. In the browser its parser gets its own nested
 * worker: the worker bundle wires itself to `self` when loaded inside a worker, so it cannot
 * share this one. In Node (tests) pdf.js runs its parser in-thread by itself.
 */
export function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    if (typeof Worker !== "undefined" && pdfjs.GlobalWorkerOptions.workerPort === null) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url), {
        type: "module",
      })
    }
    return pdfjs
  })()
  return loading
}

/** Canvases for rendering inside a worker, where there is no `document`. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)))
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) }
  }
  reset(pair: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!pair.canvas) throw new Error("Canvas is not specified")
    pair.canvas.width = Math.max(1, Math.floor(width))
    pair.canvas.height = Math.max(1, Math.floor(height))
  }
  destroy(pair: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (pair.canvas) pair.canvas.width = pair.canvas.height = 0
    pair.canvas = null
    pair.context = null
  }
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  const inBrowser = typeof OffscreenCanvas !== "undefined"
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      useSystemFonts: false,
      ...(inBrowser ? { CanvasFactory: OffscreenCanvasFactory as never, isOffscreenCanvasSupported: true } : {}),
    }).promise
  } catch (e) {
    const name = e instanceof Error ? e.name : ""
    throw new Error(name === "PasswordException" ? "pdf-password" : "pdf-invalid")
  }
}

type Matrix6 = [number, number, number, number, number, number]
const multiply = (m: Matrix6, n: Matrix6): Matrix6 => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Matrix6, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/**
 * Straight lines drawn on the page (table borders). Paths are given in user space, so the
 * current transformation matrix is tracked through save/restore/transform.
 */
async function pageRules(pdfjs: PdfJs, page: PDFPageProxy, view: Matrix6): Promise<Rule[]> {
  const { OPS } = pdfjs
  const ops = await page.getOperatorList()
  const rules: Rule[] = []
  const stack: Matrix6[] = []
  // Starting from the viewport transform gives top-down page coordinates, rotation included.
  let ctm: Matrix6 = view
  const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 }
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? view
    else if (fn === OPS.transform && Array.isArray(args) && args.length === 6) ctm = multiply(ctm, args as Matrix6)
    else if (fn === OPS.constructPath && Array.isArray(args)) {
      const raw = (args[1] as unknown[] | undefined)?.[0]
      const path = raw instanceof Float32Array || Array.isArray(raw) ? Array.from(raw as ArrayLike<number>) : []
      const points: [number, number][] = []
      let start: [number, number] | null = null
      const segment = (a: [number, number], b: [number, number]) => {
        const [x0, y0] = apply(ctm, ...a)
        const [x1, y1] = apply(ctm, ...b)
        // Only horizontal or vertical lines are table borders.
        if (Math.abs(x1 - x0) < 1 || Math.abs(y1 - y0) < 1) {
          rules.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) })
        }
      }
      for (let k = 0; k < path.length; ) {
        const op = path[k]
        if (op === DRAW.moveTo) {
          start = [path[k + 1] ?? 0, path[k + 2] ?? 0]
          points.length = 0
          points.push(start)
          k += 3
        } else if (op === DRAW.lineTo) {
          const p: [number, number] = [path[k + 1] ?? 0, path[k + 2] ?? 0]
          const last = points[points.length - 1]
          if (last) segment(last, p)
          points.push(p)
          k += 3
        } else if (op === DRAW.curveTo) {
          points.push([path[k + 5] ?? 0, path[k + 6] ?? 0])
          k += 7
        } else if (op === DRAW.quadraticCurveTo) {
          points.push([path[k + 3] ?? 0, path[k + 4] ?? 0])
          k += 5
        } else if (op === DRAW.closePath) {
          const last = points[points.length - 1]
          if (last && start) segment(last, start)
          k += 1
        } else break
      }
    }
  })
  // A thin filled rectangle is drawn as a closed path: its long edges become two rules on
  // top of each other, which is harmless for boundary detection.
  return rules
}

export async function readPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageData> {
  const pdfjs = await loadPdfJs()
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const view = viewport.transform as Matrix6
  const content = await page.getTextContent()
  const glyphs: Glyph[] = []
  for (const item of content.items) {
    if (!("str" in item) || item.str.trim() === "") continue
    const [a, b, , , e, f] = multiply(view, item.transform as Matrix6)
    // Only left-to-right horizontal text; vertical labels and stamps are not table content.
    if (a <= 0 || Math.abs(b) > 0.01 * a) continue
    glyphs.push({ text: item.str, x0: e, x1: e + item.width, y: f, h: Math.hypot(a, b) || item.height })
  }
  const rules = await pageRules(pdfjs, page, view)
  page.cleanup()
  return { page: pageNumber, width: viewport.width, height: viewport.height, glyphs, rules, ocr: false }
}

/** A page without a usable text layer (scanned) needs OCR. */
export function needsOcr(page: PageData): boolean {
  return page.glyphs.reduce((n, g) => n + g.text.trim().length, 0) < 10
}

/** Renders a page to a bitmap for OCR at `scale` × 72 DPI. */
export async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, scale: number): Promise<OffscreenCanvas> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("pdf-render")
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
  page.cleanup()
  return canvas
}

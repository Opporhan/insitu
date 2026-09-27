import type { Worker as OcrWorker } from "tesseract.js"
import type { Glyph } from "./layout"

/** Words recognised with less confidence than this are counted in the report. */
const LOW_CONFIDENCE = 70
/** Engine + language model download (first use) and one page's recognition may take this long at most. */
const START_TIMEOUT_MS = 120_000
const PAGE_TIMEOUT_MS = 120_000

/** Rejects with `pdf-ocr-failed` instead of waiting forever (e.g. a download cut off mid-stream). */
function limit<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pdf-ocr-failed")), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        reject(new Error("pdf-ocr-failed"))
      },
    )
  })
}

export type OcrPage = { glyphs: Glyph[]; lowConfidenceWords: number; restoredLetters: number }

type Word = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** Turkish letters folded to ASCII, lower case: "Beşiktaş" and "Besiktas" compare equal. */
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
}

function overlap(a: Word["bbox"], b: Word["bbox"]): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const area = (r: Word["bbox"]) => (r.x1 - r.x0) * (r.y1 - r.y0)
  return (w * h) / Math.min(area(a), area(b))
}

const LETTERS_ONLY = /^[\p{L}.,:;'’()-]+$/u

/**
 * Two engines read every page, in parallel:
 * - "tur+eng" gives the words, positions and digits (the Turkish-only model misreads digits:
 *   "1" → "E", "52,70" → "52,10", which would corrupt sums);
 * - "tur" gives Turkish letters, which "tur+eng" often drops ("Beşiktaş" → "Besiktas").
 * A word's letters are taken from the Turkish pass only when both passes saw a letters-only
 * word at the same place that is identical once Turkish letters are folded. Digits never change.
 */
function restoreLetters(main: readonly Word[], letters: readonly Word[]): { words: Word[]; restored: number } {
  let restored = 0
  const words = main.map((w) => {
    if (!LETTERS_ONLY.test(w.text)) return w
    const twin = letters.find((l) => overlap(w.bbox, l.bbox) >= 0.6 && LETTERS_ONLY.test(l.text))
    if (!twin || twin.text === w.text || fold(twin.text) !== fold(w.text)) return w
    restored++
    return { ...w, text: twin.text }
  })
  return { words, restored }
}

type Line = { words: Word[]; baseline: { x0: number; y0: number; x1: number; y1: number } }

function linesOf(data: { blocks: { paragraphs: { lines: Line[] }[] }[] | null }): Line[] {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
}

/**
 * In-browser OCR (tesseract.js). Only the engine and language models are downloaded (once,
 * then cached by the browser); the page image never leaves the device.
 */
export class PageReader {
  #workers: Promise<[OcrWorker, OcrWorker]> | null = null

  #start(): Promise<[OcrWorker, OcrWorker]> {
    this.#workers ??= limit(
      (async () => {
        const { createWorker, PSM } = await import("tesseract.js")
        const workers = await Promise.all([createWorker(["tur", "eng"]), createWorker("tur")])
        // One uniform block keeps every cell, including lone single digits that sparse-text
        // mode drops (a quantity column of "1"…"9"); column structure comes from layout.ts.
        await Promise.all(
          workers.map((w) => w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" })),
        )
        return workers
      })(),
      START_TIMEOUT_MS,
    )
    return this.#workers
  }

  /** Recognises one rendered page; coordinates are converted back to PDF points. */
  async read(image: Blob, scale: number): Promise<OcrPage> {
    const [main, turkish] = await this.#start()
    // rotateAuto straightens slightly skewed scans, so a table row stays on one line.
    const [a, b] = await limit(
      Promise.all([main, turkish].map((w) => w.recognize(image, { rotateAuto: true }, { blocks: true }))),
      PAGE_TIMEOUT_MS,
    )
    const letterWords = linesOf(b?.data ?? { blocks: null }).flatMap((l) => l.words)
    const glyphs: Glyph[] = []
    let lowConfidenceWords = 0
    let restoredLetters = 0
    for (const line of linesOf(a?.data ?? { blocks: null })) {
      const { words, restored } = restoreLetters(line.words, letterWords)
      restoredLetters += restored
      const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((x, y) => x - y)
      const h = heights[Math.floor(heights.length / 2)] ?? 0
      const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = line.baseline
      for (const word of words) {
        const text = word.text.trim()
        if (!text) continue
        if (word.confidence < LOW_CONFIDENCE) lowConfidenceWords++
        const center = (word.bbox.x0 + word.bbox.x1) / 2
        const baseline = bx1 !== bx0 ? by0 + ((by1 - by0) * (center - bx0)) / (bx1 - bx0) : word.bbox.y1
        glyphs.push({ text, x0: word.bbox.x0 / scale, x1: word.bbox.x1 / scale, y: baseline / scale, h: h / scale })
      }
    }
    return { glyphs, lowConfidenceWords, restoredLetters }
  }

  async close(): Promise<void> {
    const workers = this.#workers
    this.#workers = null
    const started = workers ? await workers.catch(() => null) : null
    await Promise.all((started ?? []).map((w) => w.terminate()))
  }
}

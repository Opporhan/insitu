import { toBlob } from "html-to-image"
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n"
import { CHUNK_ROWS, yieldToBrowser } from "@/lib/schedule"
import type { OutputColumn, ResultRow, ResultValue, ValueFormat } from "@/lib/schema"

/**
 * The anchor must be in the document for Firefox, and the object URL must outlive the
 * click — revoking it synchronously can cancel the download in Firefox and Safari.
 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function isSafari(): boolean {
  return /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)
}

/** Browsers cap canvas area (Safari ~16.7M px); stay under it instead of producing a blank image. */
const MAX_CANVAS_PIXELS = 16_000_000
const PNG_PIXEL_RATIO = 3

export async function downloadPng(node: HTMLElement, fileName: string): Promise<void> {
  const { width, height } = node.getBoundingClientRect()
  const pixelRatio = Math.min(PNG_PIXEL_RATIO, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)))
  const options = { pixelRatio, backgroundColor: getComputedStyle(node).backgroundColor }
  // Safari often drops web fonts on the first render; a warm-up pass fixes the real one.
  if (isSafari()) await toBlob(node, options)
  const blob = await toBlob(node, options)
  if (!blob) throw new Error("PNG could not be created")
  saveBlob(blob, `${fileName}.png`)
}

// Spreadsheet conventions per UI language, no thousands grouping.
// Turkish Excel: ";" separator and "," decimal mark. English: "," and ".".
const SEPARATOR: Record<Locale, string> = { tr: ";", en: "," }

/** Decimals kept per column format: money to the cent, counts whole, ratios readable. */
const EXPORT_DECIMALS: Record<ValueFormat, number> = {
  currency: 2,
  percent: 2,
  integer: 0,
  number: 4,
  text: 4,
  date: 4,
  month: 4,
}

const numberFormats = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: Locale, decimals: number): Intl.NumberFormat {
  const key = `${locale}:${decimals}`
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { useGrouping: false, maximumFractionDigits: decimals })
    numberFormats.set(key, f)
  }
  return f
}

/** Text a spreadsheet would run as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: ResultValue, format: ValueFormat, separator: string, locale: Locale): string {
  if (value === null) return ""
  const s =
    typeof value === "number"
      ? numberFormat(locale, EXPORT_DECIMALS[format]).format(value)
      : FORMULA_START.test(value)
        ? `'${value}`
        : value
  return s.includes(separator) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toDelimited(columns: readonly OutputColumn[], rows: readonly ResultRow[], separator: string, locale: Locale): string {
  const lines = [
    columns.map((c) => cell(c.label, "text", separator, locale)).join(separator),
    ...rows.map((r) => columns.map((c) => cell(r[c.key] ?? null, c.format, separator, locale)).join(separator)),
  ]
  return lines.join("\r\n")
}

/** Same output as `toDelimited`, built in chunks with yields so 100k-row exports stay smooth. */
export async function toDelimitedAsync(
  columns: readonly OutputColumn[],
  rows: readonly ResultRow[],
  separator: string,
  locale: Locale,
): Promise<string> {
  const parts = [columns.map((c) => cell(c.label, "text", separator, locale)).join(separator)]
  for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
    for (const r of rows.slice(start, start + CHUNK_ROWS)) {
      parts.push(columns.map((c) => cell(r[c.key] ?? null, c.format, separator, locale)).join(separator))
    }
    if (start + CHUNK_ROWS < rows.length) await yieldToBrowser()
  }
  return parts.join("\r\n")
}

export function toCsv(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale = DEFAULT_LOCALE): string {
  return toDelimited(columns, rows, SEPARATOR[locale], locale)
}

/** Tab-separated, so pasting into Excel or Google Sheets fills cells instead of one column. */
export function toTsv(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale = DEFAULT_LOCALE): string {
  return toDelimited(columns, rows, "\t", locale)
}

/**
 * Starts the clipboard write synchronously inside the click, then fills it when the rows
 * are ready: Safari/Firefox reject clipboard writes that begin after an async gap.
 */
export async function copyTable(
  columns: readonly OutputColumn[],
  rows: Promise<readonly ResultRow[]> | readonly ResultRow[],
  locale: Locale,
): Promise<void> {
  const text = Promise.resolve(rows).then((r) => toDelimitedAsync(columns, r, "\t", locale))
  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }))
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })])
      return
    } catch {
      // Older engines without promise-valued ClipboardItem: fall back below.
    }
  }
  await navigator.clipboard.writeText(await text)
}

export async function downloadCsv(
  columns: readonly OutputColumn[],
  rows: readonly ResultRow[],
  fileName: string,
  locale: Locale,
): Promise<void> {
  const csv = await toDelimitedAsync(columns, rows, SEPARATOR[locale], locale)
  // BOM so Excel opens Turkish characters correctly.
  saveBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${fileName}.csv`)
}

import { toPng } from "html-to-image"
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n"
import type { OutputColumn, ResultRow, ResultValue } from "@/lib/schema"

function download(href: string, fileName: string): void {
  const a = document.createElement("a")
  a.href = href
  a.download = fileName
  a.click()
}

export async function downloadPng(node: HTMLElement, fileName: string): Promise<void> {
  const background = getComputedStyle(node).backgroundColor
  download(await toPng(node, { pixelRatio: 3, backgroundColor: background }), `${fileName}.png`)
}

// Spreadsheet conventions per UI language, no thousands grouping, full precision.
// Turkish Excel: ";" separator and "," decimal mark. English: "," and ".".
const SPREADSHEET: Record<Locale, { separator: string; number: Intl.NumberFormat }> = {
  tr: { separator: ";", number: new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 10 }) },
  en: { separator: ",", number: new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 10 }) },
}

function cell(value: ResultValue, separator: string, number: Intl.NumberFormat): string {
  if (value === null) return ""
  const s = typeof value === "number" ? number.format(value) : value
  return s.includes(separator) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toDelimited(columns: readonly OutputColumn[], rows: readonly ResultRow[], separator: string, locale: Locale): string {
  const { number } = SPREADSHEET[locale]
  const lines = [
    columns.map((c) => cell(c.label, separator, number)).join(separator),
    ...rows.map((r) => columns.map((c) => cell(r[c.key] ?? null, separator, number)).join(separator)),
  ]
  return lines.join("\r\n")
}

export function toCsv(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale = DEFAULT_LOCALE): string {
  return toDelimited(columns, rows, SPREADSHEET[locale].separator, locale)
}

/** Tab-separated, so pasting into Excel or Google Sheets fills cells instead of one column. */
export function toTsv(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale = DEFAULT_LOCALE): string {
  return toDelimited(columns, rows, "\t", locale)
}

export async function copyTable(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale): Promise<void> {
  await navigator.clipboard.writeText(toTsv(columns, rows, locale))
}

export function downloadCsv(columns: readonly OutputColumn[], rows: readonly ResultRow[], fileName: string, locale: Locale): void {
  // BOM so Excel opens Turkish characters correctly.
  const blob = new Blob(["\uFEFF" + toCsv(columns, rows, locale)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  download(url, `${fileName}.csv`)
  URL.revokeObjectURL(url)
}

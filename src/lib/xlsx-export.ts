import { utils, write, type CellObject, type WorkSheet } from "xlsx"
import type { Locale } from "@/lib/i18n"
import type { OutputColumn, ResultRow } from "@/lib/schema"

/**
 * Result → .xlsx with real cell types: numbers stay numbers (₺, percent and thousands shown
 * by number formats, so sums in Excel work), dates are Excel dates. Loaded only when the user
 * asks for an .xlsx file.
 */

const NUMBER_FORMATS = {
  currency: '"₺"#,##0.00',
  integer: "#,##0",
  number: "General",
  // Values are on a 0–100 scale; the sign is text so the value itself is not divided by 100.
  percent: '0.00"%"',
} as const

const DATE_FORMATS: Record<Locale, { day: string; time: string; month: string }> = {
  tr: { day: "dd.mm.yyyy", time: "dd.mm.yyyy hh:mm", month: "mm.yyyy" },
  en: { day: "yyyy-mm-dd", time: "yyyy-mm-dd hh:mm", month: "yyyy-mm" },
}

/** "YYYY-MM[-DD[ HH:MM[:SS]]]" → Excel serial (days since 1899-12-30), computed in UTC so no zone shifts. */
function excelSerial(text: string): { serial: number; hasTime: boolean } | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (!m) return null
  const [, y, mo, d = "01", hh = "00", mm = "00", ss = "00"] = m
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))
  if (Number.isNaN(ms)) return null
  return { serial: ms / 86_400_000 + 25_569, hasTime: `${hh}:${mm}:${ss}` !== "00:00:00" }
}

function toCell(value: ResultRow[string], column: OutputColumn, locale: Locale): CellObject | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const z = column.format in NUMBER_FORMATS ? NUMBER_FORMATS[column.format as keyof typeof NUMBER_FORMATS] : "General"
    return { t: "n", v: value, z }
  }
  if (column.format === "date" || column.format === "month") {
    const date = excelSerial(value)
    if (date) {
      const f = DATE_FORMATS[locale]
      return { t: "n", v: date.serial, z: column.format === "month" ? f.month : date.hasTime ? f.time : f.day }
    }
  }
  // Text cells are never formulas in .xlsx, so "=…" values are harmless here.
  return { t: "s", v: value }
}

export function buildXlsx(columns: readonly OutputColumn[], rows: readonly ResultRow[], locale: Locale, sheetName: string): ArrayBuffer {
  const sheet: WorkSheet = utils.aoa_to_sheet([columns.map((c) => c.label)])
  rows.forEach((row, r) => {
    columns.forEach((column, c) => {
      const cell = toCell(row[column.key] ?? null, column, locale)
      if (cell) sheet[utils.encode_cell({ r: r + 1, c })] = cell
    })
  })
  sheet["!ref"] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: Math.max(0, columns.length - 1) } })
  // Width from the longest of the label and a sample of values, within reason.
  sheet["!cols"] = columns.map((c) => ({
    wch: Math.min(48, Math.max(c.label.length, ...rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length), 8) + 2),
  }))
  const book = utils.book_new()
  // Sheet names: max 31 characters, none of : \ / ? * [ ]
  utils.book_append_sheet(book, sheet, sheetName.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Insitu")
  return write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

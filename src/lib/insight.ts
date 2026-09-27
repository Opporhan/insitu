import { formatCount, formatRatio, formatValue } from "@/lib/format"
import { DEFAULT_LOCALE, messages, type Locale } from "@/lib/i18n"
import { preciseSum } from "@/lib/math"
import type { OutputColumn, ResultValue } from "@/lib/schema"
import { MAX_TABLE_ROWS, type ResultView, type XYDatum } from "@/lib/result-view"

/** Relative change, or null when the base is zero (no meaningful percentage). */
function change(from: number, to: number): number | null {
  return from === 0 ? null : (to - from) / Math.abs(from)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

type Point = { x: ResultValue; value: number; series: string }

// A running total always "rises"; a first→last percentage on it is meaningless.
const CUMULATIVE = /k[uü]m[uü]latif|cumulative|birikimli|artan toplam|running/i

function points(data: readonly XYDatum[], series: readonly { key: string; label: string }[]): Point[] {
  return data.flatMap((d) =>
    series.flatMap((s) => {
      const v = d[s.key]
      return typeof v === "number" ? [{ x: d.x, value: v, series: s.label }] : []
    }),
  )
}

/**
 * One-sentence takeaway computed locally from the actual result. The translator
 * never sees the data, so it cannot (and must not) write this sentence itself.
 */
/** First and last day of the file's date column ("YYYY-MM-DD…"), when the file has exactly one. */
export type Coverage = { from: string; to: string }

const MONTH_KEY = /^(\d{4})-(\d{2})/
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
/** "2026-09" is partial when the data stops before its last day (or starts after its first). */
function partialMonth(x: ResultValue, coverage: Coverage, edge: "from" | "to"): boolean {
  const m = MONTH_KEY.exec(String(x ?? ""))
  const c = MONTH_KEY.exec(coverage[edge])
  if (!m || !c || m[0] !== c[0]) return false
  const day = Number(coverage[edge].slice(8, 10))
  return edge === "to" ? day < daysIn(Number(m[1]), Number(m[2])) : day > 1
}

export function buildInsight(view: ResultView, locale: Locale = DEFAULT_LOCALE, coverage: Coverage | null = null): string {
  const t = messages[locale].insight
  const fmt = (value: ResultValue, column: OutputColumn) => formatValue(value, column.format, false, locale)
  const ratio = (r: number) => formatRatio(r, locale)
  const signed = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${ratio(Math.abs(r))}`

  switch (view.kind) {
    case "empty":
      return t.empty

    case "metric":
      return view.items.map((i) => `${i.column.label}: ${fmt(i.value, i.column)}`).join(" · ") + "."

    case "table": {
      if (view.partial) return t.tablePartial(MAX_TABLE_ROWS)
      // Totals cover every result row, so the sentence counts them all, not just the ones shown.
      const rows = formatCount(view.rowCount, locale)
      const head = view.truncated ? t.tableTruncated(MAX_TABLE_ROWS) : t.tableRows(rows)
      const totals = view.columns
        .filter((c) => c.key in view.totals)
        .map((c) => t.tableTotal(c.label, rows, fmt(view.totals[c.key] ?? null, c)))
      return totals.length > 0 ? `${head} ${totals.join(" · ")}.` : head
    }

    case "pie": {
      const [top] = view.slices
      if (!top) return t.empty
      const total = view.value.format === "percent" ? "" : t.pieTotal(fmt(view.total, view.value))
      return t.pie(top.name, ratio(top.share), fmt(top.value, view.value)) + total
    }

    case "bar": {
      const pts = points(view.data, view.series)
      if (pts.length === 0) return t.noNumbers
      const label = (p: Point) => (view.series.length > 1 ? `${fmt(p.x, view.x)} · ${p.series}` : fmt(p.x, view.x))
      const max = pts.reduce((a, b) => (b.value > a.value ? b : a))
      const min = pts.reduce((a, b) => (b.value < a.value ? b : a))
      if (pts.length === 1) return t.single(label(max), fmt(max.value, view.y))
      // Only for summable measures (amounts, counts) — never for prices or averages.
      const sum = view.y.total ? t.shownSum(pts.length, fmt(preciseSum(pts.map((p) => p.value)), view.y)) : ""
      if (max.value === min.value) return t.allEqual(fmt(max.value, view.y)) + sum
      const diff = min.value > 0 ? t.diff(ratio((max.value - min.value) / min.value)) : ""
      return t.maxMin(label(max), fmt(max.value, view.y), label(min), fmt(min.value, view.y)) + diff + sum
    }

    case "line": {
      if (view.series.length > 1) {
        const last = view.data[view.data.length - 1]
        const lastPts = last ? points([last], view.series) : []
        if (lastPts.length === 0) return t.noNumbers
        const lead = lastPts.reduce((a, b) => (b.value > a.value ? b : a))
        return t.seriesLead(fmt(lead.x, view.x), lead.series, fmt(lead.value, view.y))
      }
      const pts = points(view.data, view.series)
      const first = pts[0]
      const last = pts[pts.length - 1]
      if (!first || !last) return t.noNumbers
      if (pts.length === 1) return t.single(fmt(first.x, view.x), fmt(first.value, view.y))
      if (CUMULATIVE.test(`${view.y.key} ${view.y.label}`)) return t.cumulative(fmt(last.x, view.x), fmt(last.value, view.y))
      const peak = pts.reduce((a, b) => (b.value > a.value ? b : a))
      // Monthly series and a known date range: a month the data only partly covers is never
      // compared ("Ocak → Eylül" when the data stops on 24 September would be misleading).
      const monthly = view.x.format === "month" || pts.every((p) => MONTH_KEY.test(String(p.x ?? "")))
      if (coverage && monthly && pts.length >= 3) {
        const startPartial = partialMonth(first.x, coverage, "from")
        const endPartial = partialMonth(last.x, coverage, "to")
        if (startPartial || endPartial) {
          const from = startPartial ? (pts[1] ?? first) : first
          const to = endPartial ? (pts[pts.length - 2] ?? last) : last
          const c = change(from.value, to.value)
          const text = t.trend(
            fmt(from.x, view.x),
            fmt(to.x, view.x),
            fmt(from.value, view.y),
            fmt(to.value, view.y),
            c === null ? "" : ` (${signed(c)})`,
            fmt(peak.x, view.x),
            fmt(peak.value, view.y),
          )
          const day = (d: string) => formatValue(d.slice(0, 10), "date", false, locale)
          return (
            text +
            (startPartial ? t.partialStart(fmt(first.x, view.x), day(coverage.from)) : "") +
            (endPartial ? t.partialEnd(fmt(last.x, view.x), day(coverage.to)) : "")
          )
        }
      }
      // Otherwise: a last period far below the rest is usually one that has only just started
      // (e.g. 1 day of the month); comparing against it would report a fake collapse.
      const incomplete = pts.length >= 4 && last.value >= 0 && last.value < 0.25 * median(pts.slice(0, -1).map((p) => p.value))
      const end = incomplete ? (pts[pts.length - 2] ?? last) : last
      const c = change(first.value, end.value)
      const trend = t.trend(
        fmt(first.x, view.x),
        fmt(end.x, view.x),
        fmt(first.value, view.y),
        fmt(end.value, view.y),
        c === null ? "" : ` (${signed(c)})`,
        fmt(peak.x, view.x),
        fmt(peak.value, view.y),
      )
      return incomplete ? trend + t.incomplete(fmt(last.x, view.x), fmt(last.value, view.y), fmt(end.x, view.x)) : trend
    }
  }
}

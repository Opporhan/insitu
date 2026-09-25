import { isNumericFormat } from "@/lib/format"
import { preciseSum } from "@/lib/math"
import type { OutputColumn, QueryPlan, ResultRow, ResultValue } from "@/lib/schema"

export const MAX_SERIES = 8
export const MAX_BAR_CATEGORIES = 30
export const MAX_PIE_SLICES = 7
export const MAX_TABLE_ROWS = 500
/** More points than this makes the SVG line chart sluggish; such results are shown as a table. */
export const MAX_LINE_POINTS = 2000
export const OTHER_LABEL = "Diğer"

export type Series = { key: string; label: string }

/** One row per x value; series values live under safe keys `s0`, `s1`, … */
export type XYDatum = { x: ResultValue } & Record<string, number | null | ResultValue>

export type PieSlice = { name: string; value: number; share: number }

export type ResultView =
  | { kind: "empty" }
  | { kind: "metric"; items: { column: OutputColumn; value: ResultValue }[] }
  | { kind: "bar" | "line"; x: OutputColumn; y: OutputColumn; series: Series[]; data: XYDatum[] }
  | { kind: "pie"; label: OutputColumn; value: OutputColumn; slices: PieSlice[]; total: number }
  | {
      kind: "table"
      columns: OutputColumn[]
      rows: ResultRow[]
      truncated: boolean
      /** The query returned more rows than were fetched; no totals or charts are derived. */
      partial: boolean
      /** Grand totals over ALL result rows, only for columns declared summable. */
      totals: Record<string, number>
    }

/**
 * Reconciles the declared output columns with what the query actually returned.
 * Undeclared columns get a neutral label; a declared format that contradicts the
 * values (e.g. "currency" on text) is corrected instead of trusted.
 */
export function resolveColumns(declared: readonly OutputColumn[], resultKeys: readonly string[], rows: readonly ResultRow[]): OutputColumn[] {
  const byKey = new Map(declared.map((c) => [c.key, c]))
  return resultKeys.map((key) => {
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
    const allNumbers = values.length > 0 && values.every((v) => typeof v === "number")
    const col: OutputColumn = byKey.get(key) ?? { key, label: key, format: allNumbers ? "number" : "text", total: false }
    if (isNumericFormat(col.format) && !allNumbers && values.length > 0) return { ...col, format: "text", total: false }
    if (!isNumericFormat(col.format) && allNumbers) return { ...col, format: "number", total: false }
    return col
  })
}

function isNumericColumn(col: OutputColumn, rows: readonly ResultRow[]): boolean {
  return isNumericFormat(col.format) && rows.every((r) => r[col.key] === null || typeof r[col.key] === "number")
}

function table(columns: OutputColumn[], rows: readonly ResultRow[], partial = false): ResultView {
  const totals: Record<string, number> = {}
  // A total over a single row just repeats it; a total over a partial result would be wrong.
  if (rows.length > 1 && !partial) {
    for (const c of columns) {
      if (c.total && isNumericColumn(c, rows)) {
        totals[c.key] = preciseSum(rows.flatMap((r) => (typeof r[c.key] === "number" ? [r[c.key] as number] : [])))
      }
    }
  }
  return {
    kind: "table",
    columns,
    rows: rows.slice(0, MAX_TABLE_ROWS),
    truncated: partial || rows.length > MAX_TABLE_ROWS,
    partial,
    totals,
  }
}

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?/

function xyView(
  kind: "bar" | "line",
  x: OutputColumn,
  y: OutputColumn,
  seriesCol: OutputColumn | undefined,
  rows: readonly ResultRow[],
): ResultView | null {
  const xKey = (v: ResultValue) => (v === null ? "\u0000null" : `${typeof v}:${v}`)

  // Series ordered by their total so colors follow importance.
  let series: { key: string; label: string; raw: ResultValue }[] = [{ key: "s0", label: y.label, raw: null }]
  if (seriesCol) {
    const totals = new Map<string, { raw: ResultValue; total: number }>()
    for (const r of rows) {
      const k = xKey(r[seriesCol.key] ?? null)
      const prev = totals.get(k) ?? { raw: r[seriesCol.key] ?? null, total: 0 }
      prev.total += typeof r[y.key] === "number" ? Math.abs(r[y.key] as number) : 0
      totals.set(k, prev)
    }
    if (totals.size > MAX_SERIES) return null
    series = [...totals.values()]
      .sort((a, b) => b.total - a.total)
      .map((s, i) => ({ key: `s${i}`, label: s.raw === null ? "—" : String(s.raw), raw: s.raw }))
  }
  const seriesIndex = new Map(series.map((s) => [xKey(s.raw), s.key]))

  const data: XYDatum[] = []
  const byX = new Map<string, XYDatum>()
  for (const r of rows) {
    const xv = r[x.key] ?? null
    let datum = byX.get(xKey(xv))
    if (!datum) {
      datum = { x: xv }
      byX.set(xKey(xv), datum)
      data.push(datum)
    }
    const sKey = seriesCol ? seriesIndex.get(xKey(r[seriesCol.key] ?? null)) : "s0"
    if (sKey === undefined) return null
    // The same (x, series) twice means the query was not aggregated to this grain.
    if (sKey in datum) return null
    const yv = r[y.key]
    datum[sKey] = typeof yv === "number" ? yv : null
  }

  if (kind === "bar" && data.length > MAX_BAR_CATEGORIES) return null
  if (kind === "line" && data.length > MAX_LINE_POINTS) return null
  if (kind === "line" && data.every((d) => typeof d.x === "string" && ISO_DATE.test(d.x))) {
    data.sort((a, b) => String(a.x).localeCompare(String(b.x)))
  }
  if (seriesCol) for (const d of data) for (const s of series) d[s.key] ??= null

  return { kind, x, y, series: series.map(({ key, label }) => ({ key, label })), data }
}

function pieView(label: OutputColumn, value: OutputColumn, rows: readonly ResultRow[], otherLabel: string): ResultView | null {
  const names = new Set<string>()
  const raw: { name: string; value: number }[] = []
  for (const r of rows) {
    const v = r[value.key]
    if (typeof v !== "number" || v < 0) return null
    const name = r[label.key] === null || r[label.key] === undefined ? "—" : String(r[label.key])
    if (names.has(name)) return null
    names.add(name)
    raw.push({ name, value: v })
  }
  const total = preciseSum(raw.map((r) => r.value))
  if (total <= 0) return null

  raw.sort((a, b) => b.value - a.value)
  let kept = raw
  if (raw.length > MAX_PIE_SLICES) {
    kept = raw.slice(0, MAX_PIE_SLICES - 1)
    const rest = preciseSum(raw.slice(MAX_PIE_SLICES - 1).map((r) => r.value))
    const existingOther = kept.find((s) => s.name === otherLabel)
    if (existingOther) existingOther.value += rest
    else kept.push({ name: otherLabel, value: rest })
  }
  return { kind: "pie", label, value, total, slices: kept.map((s) => ({ ...s, share: s.value / total })) }
}

/**
 * Turns plan + rows into something that can be drawn correctly, or falls back to a table.
 * `complete` is false when the query returned more rows than were fetched.
 */
export function resolveView(
  plan: QueryPlan,
  rows: readonly ResultRow[],
  resultKeys: readonly string[],
  complete = true,
  otherLabel = OTHER_LABEL,
): ResultView {
  if (rows.length === 0) return { kind: "empty" }
  const columns = resolveColumns(plan.columns, resultKeys, rows)
  // Charts, metrics and totals from a cut-off result would be wrong; list what we have.
  if (!complete) return table(columns, rows, true)
  const col = (key: string) => (key ? columns.find((c) => c.key === key) : undefined)

  switch (plan.chartType) {
    case "metric":
      return rows.length === 1
        ? { kind: "metric", items: columns.map((c) => ({ column: c, value: rows[0]?.[c.key] ?? null })) }
        : table(columns, rows)
    case "bar":
    case "line": {
      const x = col(plan.xAxisKey)
      const y = col(plan.yAxisKey)
      const s = col(plan.seriesKey)
      if (!x || !y || x.key === y.key || !isNumericColumn(y, rows)) return table(columns, rows)
      const series = s && s.key !== x.key && s.key !== y.key ? s : undefined
      return xyView(plan.chartType, x, y, series, rows) ?? table(columns, rows)
    }
    case "pie": {
      const label = col(plan.xAxisKey)
      const value = col(plan.yAxisKey)
      if (!label || !value || label.key === value.key || !isNumericColumn(value, rows)) return table(columns, rows)
      return pieView(label, value, rows, otherLabel) ?? table(columns, rows)
    }
    case "table":
      return table(columns, rows)
  }
}

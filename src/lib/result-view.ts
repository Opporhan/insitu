import { isNumericFormat } from "@/lib/format"
import { preciseSum } from "@/lib/math"
import type { ChartType, OutputColumn, QueryPlan, ResultRow, ResultValue } from "@/lib/schema"

export const MAX_SERIES = 8
export const MAX_BAR_CATEGORIES = 30
export const MAX_PIE_SLICES = 7
export const MAX_TABLE_ROWS = 500
/** Table rows per exported PNG; a longer (scrolling) table is split into several images. */
export const PNG_ROWS_PER_PAGE = 25

/** [start, end) row ranges for exporting `rowCount` table rows as images. Always at least one page. */
export function pngPages(rowCount: number, perPage = PNG_ROWS_PER_PAGE): [number, number][] {
  const pages: [number, number][] = []
  for (let start = 0; start < rowCount; start += perPage) pages.push([start, Math.min(rowCount, start + perPage)])
  return pages.length > 0 ? pages : [[0, 0]]
}

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
      /** All result rows (totals cover these), even when only the first MAX_TABLE_ROWS are shown. */
      rowCount: number
      truncated: boolean
      /** The query returned more rows than were fetched; no totals or charts are derived. */
      partial: boolean
      /** Grand totals over ALL result rows, only for columns declared summable. */
      totals: Record<string, number>
    }

/** "Toplam_Satış", "toplam satis" and "toplamsatis" are the same column name. */
const keyForm = (s: string) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")

/**
 * Declared column key → the result column it describes. Exact names first, then names that
 * differ only in case/accents/underscores; columns still unmatched are paired in SELECT order
 * when the counts agree (the plan lists its columns in SELECT order), so a model that named an
 * alias slightly differently still gets its label, format and axes.
 */
export function matchColumns(declared: readonly OutputColumn[], resultKeys: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  const free = new Set(resultKeys)
  for (const c of declared) {
    if (free.has(c.key) && !map.has(c.key)) {
      map.set(c.key, c.key)
      free.delete(c.key)
    }
  }
  for (const c of declared) {
    if (map.has(c.key)) continue
    const k = [...free].find((r) => keyForm(r) === keyForm(c.key))
    if (k !== undefined) {
      map.set(c.key, k)
      free.delete(k)
    }
  }
  const leftDeclared = declared.filter((c) => !map.has(c.key))
  const leftResult = resultKeys.filter((k) => free.has(k))
  if (leftDeclared.length === leftResult.length) leftDeclared.forEach((c, i) => map.set(c.key, leftResult[i] ?? c.key))
  return map
}

const ISO_LIKE = /^\d{4}-\d{2}(-\d{2})?/

/**
 * A plan for SQL the user wrote by hand: the chart follows the result's shape (one row →
 * metric; a date and numbers → line; one category and numbers → bar; otherwise table), and a
 * column keeps its label/format from the earlier plan when it has the same name.
 */
export function planForResult(base: QueryPlan, sql: string, resultKeys: readonly string[], rows: readonly ResultRow[], labelFor: (key: string) => string): QueryPlan {
  const numeric = resultKeys.filter((k) => rows.some((r) => typeof r[k] === "number") && rows.every((r) => r[k] === null || typeof r[k] === "number"))
  const dims = resultKeys.filter((k) => !numeric.includes(k))
  const dateDim = dims.length === 1 && rows.every((r) => r[dims[0] ?? ""] === null || ISO_LIKE.test(String(r[dims[0] ?? ""])))
  const chartType: QueryPlan["chartType"] =
    rows.length === 1 ? "metric" : dims.length === 1 && numeric.length >= 1 ? (dateDim ? "line" : "bar") : "table"
  return {
    ...base,
    sql,
    chartType,
    xAxisKey: chartType === "bar" || chartType === "line" ? (dims[0] ?? "") : "",
    yAxisKey: chartType === "bar" || chartType === "line" ? (numeric[0] ?? "") : "",
    seriesKey: "",
    note: "",
    columns: resultKeys.map(
      (k) =>
        base.columns.find((c) => c.key === k) ?? {
          key: k,
          label: labelFor(k),
          format: numeric.includes(k) ? "number" : dateDim && k === dims[0] ? "date" : "text",
          total: false,
        },
    ),
  }
}

/** The plan with its column keys and axis keys pointing at the columns the query really returned. */
export function alignPlan(plan: QueryPlan, resultKeys: readonly string[]): QueryPlan {
  const map = matchColumns(plan.columns, resultKeys)
  const re = (k: string) => (k ? (map.get(k) ?? k) : k)
  return {
    ...plan,
    xAxisKey: re(plan.xAxisKey),
    yAxisKey: re(plan.yAxisKey),
    seriesKey: re(plan.seriesKey),
    columns: plan.columns.flatMap((c) => {
      const key = map.get(c.key)
      return key === undefined ? [] : [{ ...c, key }]
    }),
  }
}

/**
 * Reconciles the declared output columns with what the query actually returned.
 * Undeclared columns get a readable label (`labelFor`); a declared format that contradicts
 * the values (e.g. "currency" on text) is corrected instead of trusted.
 */
export function resolveColumns(
  declared: readonly OutputColumn[],
  resultKeys: readonly string[],
  rows: readonly ResultRow[],
  labelFor: (key: string) => string = (key) => key,
): OutputColumn[] {
  const byKey = new Map(declared.map((c) => [c.key, c]))
  return resultKeys.map((key) => {
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
    const allNumbers = values.length > 0 && values.every((v) => typeof v === "number")
    const col: OutputColumn = byKey.get(key) ?? { key, label: labelFor(key), format: allNumbers ? "number" : "text", total: false }
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
    rowCount: rows.length,
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
  labelFor: (key: string) => string = (key) => key,
): ResultView {
  if (rows.length === 0) return { kind: "empty" }
  plan = alignPlan(plan, resultKeys)
  const columns = resolveColumns(plan.columns, resultKeys, rows, labelFor)
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

export type ViewOption = { type: ChartType; view: ResultView }

const OPTION_ORDER: readonly ChartType[] = ["metric", "bar", "line", "pie", "table"]

/**
 * The ways this result can be shown *correctly*, for the view switcher. A type is offered
 * only when it really renders as that type (no silent fallback to a table), and only
 * when it makes sense for the data:
 * - line: the x axis is a date/month (or the plan already chose line),
 * - pie: one series of summable values (not averages/prices), or the plan chose pie,
 * - metric: only when the planned result is a single-row metric,
 * - table: always; for a cut-off (partial) result it is the only option.
 */
export function viewOptions(
  plan: QueryPlan,
  rows: readonly ResultRow[],
  resultKeys: readonly string[],
  complete = true,
  otherLabel = OTHER_LABEL,
  labelFor: (key: string) => string = (key) => key,
): ViewOption[] {
  const planned = resolveView(plan, rows, resultKeys, complete, otherLabel, labelFor)
  if (planned.kind === "empty") return []
  if (!complete) return [{ type: "table", view: planned }]

  const options: ViewOption[] = []
  for (const type of OPTION_ORDER) {
    const view =
      type === planned.kind ? planned : resolveView({ ...plan, chartType: type }, rows, resultKeys, complete, otherLabel, labelFor)
    if (view.kind !== type) continue
    if (type === "metric" && planned.kind !== "metric") continue
    if (view.kind === "line" && planned.kind !== "line" && view.x.format !== "date" && view.x.format !== "month") continue
    if (view.kind === "pie" && planned.kind !== "pie") {
      const single = planned.kind !== "bar" && planned.kind !== "line" ? true : planned.series.length === 1
      if (!view.value.total || !single) continue
    }
    options.push({ type, view })
  }
  return options
}

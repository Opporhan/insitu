"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { createPortal, flushSync } from "react-dom"
import { ChartColumn, ChartLine, ChartPie, Check, ChevronDown, ClipboardCopy, Code2, FileImage, FileText, Hash, Info, Sparkles, Table2 } from "lucide-react"
import { ChartView } from "@/components/chart-view"
import { useI18n } from "@/components/i18n-provider"
import { MetricView } from "@/components/metric-view"
import { TableView } from "@/components/table-view"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { runQuery, MAX_EXPORT_ROWS } from "@/lib/engine/run-query"
import { copyTable, downloadCsv, downloadPng } from "@/lib/export"
import { formatCount } from "@/lib/format"
import { buildInsight } from "@/lib/insight"
import { pngPages, viewOptions, type ResultView } from "@/lib/result-view"
import { readableLabel } from "@/lib/suggestions"
import type { ChartType, Column, OutputColumn, QueryPlan, ResultRow } from "@/lib/schema"
import { cn } from "@/lib/utils"

const VIEW_ICONS: Record<ChartType, typeof ChartColumn> = { metric: Hash, bar: ChartColumn, line: ChartLine, pie: ChartPie, table: Table2 }
const CHART_KINDS: ReadonlySet<string> = new Set(["bar", "line", "pie"])

export type Answer = {
  id: number
  question: string
  plan: QueryPlan
  /** Query result as fetched for display (at most MAX_RESULT_ROWS). */
  rows: ResultRow[]
  /** False when the query returned more rows than were fetched for display. */
  complete: boolean
  /** How many earlier questions were sent as context for this one. */
  contextTurns: number
  resultColumns: OutputColumn[]
  view: ResultView
}

/**
 * Memoized so export-button state changes never re-render the chart: Recharts hides
 * value labels while it re-animates, and a PNG taken in that window had no prices.
 */
const ResultBody = memo(function ResultBody({ view, onChartReady }: { view: ResultView; onChartReady: () => void }) {
  const { t } = useI18n()
  switch (view.kind) {
    case "empty":
      return <p className="py-10 text-center text-sm text-muted-foreground">{t.result.empty}</p>
    case "metric":
      return <MetricView view={view} />
    case "table":
      return <TableView view={view} />
    default:
      return <ChartView view={view} onReady={onChartReady} />
  }
})

type Props = {
  answer: Answer
  columns: readonly Column[]
  rowCount: number
}

function slug(s: string, locale: string): string {
  return s.toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "insitu"
}

export function ResultBento({ answer, columns, rowCount }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const { t, locale } = useI18n()
  const { question, plan, rows, complete, resultColumns, view: plannedView } = answer
  // Always from the planned view (a table view would only say "8 rows found"); computed per
  // render so switching the language updates it immediately.
  const insight = buildInsight(plannedView, locale)

  // Only the views that are correct for this data (see viewOptions) are offered.
  const options = useMemo(
    () => viewOptions(plan, rows, resultColumns.map((c) => c.key), complete, t.insight.other, (k) => readableLabel(k, locale)),
    [plan, rows, resultColumns, complete, t.insight.other, locale],
  )
  const [viewType, setViewType] = useState<string>(plannedView.kind)
  const view = options.find((o) => o.type === viewType)?.view ?? plannedView
  const fileName = `insitu-${slug(question, locale)}`
  const [status, setStatus] = useState<"idle" | "exporting" | "copied" | "error">("idle")
  // Charts animate in; exporting before that would capture half-drawn bars and no value labels.
  // (A new answer remounts this component, which resets the flag.)
  const [chartReady, setChartReady] = useState(!CHART_KINDS.has(view.kind))
  const onChartReady = useCallback(() => setChartReady(true), [])

  function switchView(type: ChartType) {
    setViewType(type)
    // A newly shown chart animates in again; PNG waits for it (see ChartView onReady).
    setChartReady(!CHART_KINDS.has(type))
  }

  // A table taller than its scroll box is exported as several images, one per page of rows.
  const pages = view.kind === "table" ? pngPages(view.rows.length) : [[0, 0] as [number, number]]
  const exportRef = useRef<HTMLDivElement>(null)
  const [exportPage, setExportPage] = useState<{ index: number; width: number } | null>(null)

  async function downloadImages() {
    const card = chartRef.current
    if (!card) return
    if (pages.length <= 1) return downloadPng(card, fileName)
    const width = card.getBoundingClientRect().width
    try {
      for (let index = 0; index < pages.length; index++) {
        // Render the page off screen synchronously, then capture it.
        flushSync(() => setExportPage({ index, width }))
        if (exportRef.current) await downloadPng(exportRef.current, `${fileName}-${index + 1}`)
        // Spaced out so browsers treat them as separate downloads.
        await new Promise((r) => setTimeout(r, 300))
      }
    } finally {
      setExportPage(null)
    }
  }

  /**
   * Exports must contain the whole result. When the display copy was cut off, the query is
   * re-run in DuckDB for all rows (bounded by MAX_EXPORT_ROWS, which the file name then states).
   */
  const fullRows = useRef<Promise<{ rows: ResultRow[]; suffix: string }> | null>(null)
  function exportRows(): Promise<{ rows: ResultRow[]; suffix: string }> {
    if (complete) return Promise.resolve({ rows, suffix: "" })
    // Fetched once and reused, so CSV then copy does not run the full query twice.
    fullRows.current ??= runQuery(plan.sql, MAX_EXPORT_ROWS).then((full) => {
      if (!full.ok) throw new Error(full.error)
      return { rows: full.rows, suffix: full.complete ? "" : t.result.firstRowsSuffix(MAX_EXPORT_ROWS) }
    })
    fullRows.current.catch(() => {
      fullRows.current = null // allow a retry after a failure
    })
    return fullRows.current
  }

  async function run(action: () => Promise<void> | void, done: "idle" | "copied" = "idle") {
    setStatus("exporting")
    try {
      await action()
      setStatus(done)
      if (done === "copied") setTimeout(() => setStatus("idle"), 2000)
    } catch {
      setStatus("error")
    }
  }

  return (
    <section aria-label={t.result.region} className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      <Card ref={chartRef} className="md:col-span-2 md:self-start">
        <CardHeader>
          <CardTitle className="text-lg tracking-tight">{plan.title}</CardTitle>
          <CardDescription>{question}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Outside the header grid: removing it from the PNG must not reflow the title/description. */}
          {options.length > 1 && (
            <div data-export-ignore="" className="mb-3 flex justify-end">
              <div role="group" aria-label={t.result.viewGroup} className="flex items-center rounded-lg border p-0.5">
                {options.map(({ type }) => {
                  const Icon = VIEW_ICONS[type]
                  const active = type === view.kind
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      title={t.result.views[type]}
                      onClick={() => switchView(type)}
                      className={cn(
                        "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="sr-only sm:not-sr-only">{t.result.views[type]}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Keyed by view type so a switched-to chart mounts fresh and reports when it is drawn. */}
          <ResultBody key={view.kind} view={view} onChartReady={onChartReady} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardDescription className="inline-flex items-center gap-1.5 text-primary">
              <Sparkles className="size-4" aria-hidden /> {t.result.insight}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-lg leading-relaxed text-pretty">{insight}</p>
            {plannedView.kind === "table" && !plannedView.partial && plan.chartType !== "table" && (
              // The translator asked for a chart but the data doesn't fit one: say so rather than switch silently.
              <p className="flex gap-1.5 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{t.result.tableFallback}</span>
              </p>
            )}
            {plan.note && (
              // An assumption the translator made (e.g. district instead of province), shown as-is.
              <p className="flex gap-1.5 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-medium text-foreground">{t.result.note}:</span> {plan.note}
                </span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>{t.result.exportTitle}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={status === "exporting" || !chartReady}
              aria-busy={!chartReady}
              {...(pages.length > 1 ? { "aria-label": t.result.pngPages(pages.length) } : {})}
              onClick={() => void run(downloadImages)}
            >
              <FileImage aria-hidden /> PNG{pages.length > 1 ? ` · ${pages.length}` : ""}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={rows.length === 0 || status === "exporting"}
              onClick={() =>
                void run(async () => {
                  const all = await exportRows()
                  await downloadCsv(resultColumns, all.rows, fileName + all.suffix, locale)
                })
              }
            >
              <FileText aria-hidden /> CSV
            </Button>
            <Button
              variant="outline"
              className="col-span-2 h-11"
              disabled={rows.length === 0 || status === "exporting"}
              onClick={() =>
                void run(() => copyTable(resultColumns, exportRows().then((all) => all.rows), locale), "copied")
              }
            >
              {status === "copied" ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
              {status === "copied" ? t.result.copied : t.result.copy}
            </Button>
            <p className="col-span-2 text-xs text-muted-foreground" aria-live="polite">
              {status === "error" ? t.result.exportFailed : t.result.copyHint}
            </p>
          </CardContent>
        </Card>

        <Card>
          <Collapsible>
            <CardHeader>
              <CollapsibleTrigger className="group/how flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <span className="inline-flex items-center gap-1.5">
                  <Code2 className="size-4" aria-hidden /> {t.result.how}
                </span>
                <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]/how:rotate-180" aria-hidden />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="flex flex-col gap-3 pt-3 text-sm">
                <p className="text-muted-foreground">{t.result.howSent(columns.length, answer.contextTurns)}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {columns.map((c) => (
                    <li key={c.name} className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs">
                      {c.name}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">{t.result.howRan(formatCount(rowCount, locale))}</p>
                <pre className="rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                  {plan.sql}
                </pre>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>

      {exportPage &&
        view.kind === "table" &&
        createPortal(
          // Off-screen, same width as the on-screen card; only the inner card is captured.
          <div aria-hidden style={{ position: "fixed", top: 0, left: -100_000, width: exportPage.width }}>
            <Card ref={exportRef}>
              <CardHeader>
                <CardTitle className="text-lg tracking-tight">{plan.title}</CardTitle>
                <CardDescription>
                  {question} · {t.result.page(exportPage.index + 1, pages.length)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TableView
                  view={view}
                  rows={view.rows.slice(...(pages[exportPage.index] ?? [0, 0]))}
                  scroll={false}
                  showTotals={exportPage.index === pages.length - 1}
                />
              </CardContent>
            </Card>
          </div>,
          document.body,
        )}
    </section>
  )
}

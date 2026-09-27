"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatValue, isNumericFormat } from "@/lib/format"
import type { ResultView } from "@/lib/result-view"
import type { ResultRow, ResultValue } from "@/lib/schema"
import { cn } from "@/lib/utils"

type Props = {
  view: Extract<ResultView, { kind: "table" }>
  /** A slice of the rows to show instead of all of them (used for paged PNG export). */
  rows?: readonly ResultRow[]
  /** Scrollable box on screen; off for export pages, which show their rows in full. */
  scroll?: boolean
  showTotals?: boolean
}

type Sort = { key: string; dir: "asc" | "desc" } | null

/** Numbers by value, text in the UI language's alphabet; empty cells always last. */
function compare(a: ResultValue | undefined, b: ResultValue | undefined, locale: string): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: "base" })
}

export function TableView({ view, rows = view.rows, scroll = true, showTotals = true }: Props) {
  const { t, locale } = useI18n()
  // On-screen sorting only (scroll mode); exported pages keep the query's own order.
  const [sort, setSort] = useState<Sort>(null)
  const shown = useMemo(() => {
    if (!sort || !scroll) return rows
    const sign = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const c = compare(a[sort.key], b[sort.key], locale)
      // Empty cells stay last in both directions.
      return a[sort.key] === null || b[sort.key] === null ? c : sign * c
    })
  }, [rows, sort, scroll, locale])
  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null))

  return (
    <div className={cn("rounded-lg border", scroll && "max-h-[480px] overflow-auto")}>
      <Table>
        <TableHeader className={cn("bg-card", scroll && "sticky top-0")}>
          <TableRow>
            {view.columns.map((c) => {
              const active = sort?.key === c.key ? sort.dir : null
              return (
                <TableHead
                  key={c.key}
                  aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined}
                  className={cn(isNumericFormat(c.format) && "text-right")}
                >
                  {scroll ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      title={`${c.label} · ${t.result.sortBy}`}
                      className={cn(
                        "inline-flex min-h-11 max-w-[16rem] items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        isNumericFormat(c.format) && "flex-row-reverse",
                      )}
                    >
                      <span className="truncate">{c.label}</span>
                      {active === "asc" && <ArrowUp className="size-3.5 shrink-0" aria-hidden />}
                      {active === "desc" && <ArrowDown className="size-3.5 shrink-0" aria-hidden />}
                    </button>
                  ) : (
                    c.label
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, i) => (
            <TableRow key={i}>
              {view.columns.map((c) => (
                <TableCell key={c.key} className={cn(isNumericFormat(c.format) && "text-right font-mono tabular-nums")}>
                  {formatValue(row[c.key] ?? null, c.format, false, locale)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {showTotals && Object.keys(view.totals).length > 0 && (
          <TableFooter className={cn("bg-card", scroll && "sticky bottom-0")}>
            <TableRow>
              {view.columns.map((c, i) => {
                const total = view.totals[c.key]
                return (
                  <TableCell key={c.key} className={cn("font-medium", isNumericFormat(c.format) && "text-right font-mono tabular-nums")}>
                    {total !== undefined ? formatValue(total, c.format, false, locale) : i === 0 ? t.result.listTotal : ""}
                  </TableCell>
                )
              })}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}

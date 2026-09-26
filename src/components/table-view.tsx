"use client"

import { useI18n } from "@/components/i18n-provider"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatValue, isNumericFormat } from "@/lib/format"
import type { ResultView } from "@/lib/result-view"
import type { ResultRow } from "@/lib/schema"
import { cn } from "@/lib/utils"

type Props = {
  view: Extract<ResultView, { kind: "table" }>
  /** A slice of the rows to show instead of all of them (used for paged PNG export). */
  rows?: readonly ResultRow[]
  /** Scrollable box on screen; off for export pages, which show their rows in full. */
  scroll?: boolean
  showTotals?: boolean
}

export function TableView({ view, rows = view.rows, scroll = true, showTotals = true }: Props) {
  const { t, locale } = useI18n()
  return (
    <div className={cn("rounded-lg border", scroll && "max-h-[480px] overflow-auto")}>
      <Table>
        <TableHeader className={cn("bg-card", scroll && "sticky top-0")}>
          <TableRow>
            {view.columns.map((c) => (
              <TableHead key={c.key} className={cn(isNumericFormat(c.format) && "text-right")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
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

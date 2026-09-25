"use client"

import { useI18n } from "@/components/i18n-provider"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatValue, isNumericFormat } from "@/lib/format"
import type { ResultView } from "@/lib/result-view"
import { cn } from "@/lib/utils"

export function TableView({ view }: { view: Extract<ResultView, { kind: "table" }> }) {
  const { t, locale } = useI18n()
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            {view.columns.map((c) => (
              <TableHead key={c.key} className={cn(isNumericFormat(c.format) && "text-right")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.rows.map((row, i) => (
            <TableRow key={i}>
              {view.columns.map((c) => (
                <TableCell key={c.key} className={cn(isNumericFormat(c.format) && "text-right font-mono tabular-nums")}>
                  {formatValue(row[c.key] ?? null, c.format, false, locale)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {Object.keys(view.totals).length > 0 && (
          <TableFooter className="sticky bottom-0 bg-card">
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

"use client"

import { ChevronDown, ClipboardCheck, TriangleAlert } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { TableView } from "@/components/table-view"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Dataset } from "@/lib/engine/load-file"
import { formatCount, formatRatio, formatValue } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ResultView } from "@/lib/result-view"
import type { OutputColumn, ValueFormat } from "@/lib/schema"

type Props = { dataset: Dataset; open: boolean; onOpenChange: (open: boolean) => void }

const FORMAT: Record<string, ValueFormat> = { number: "number", date: "date", text: "text" }

/** What ingestion changed in the raw file, plus the first rows of the cleaned table. */
export function DataPrepPanel({ dataset, open, onOpenChange }: Props) {
  const { t, locale } = useI18n()
  const r = dataset.report
  const p = t.prep

  const lines: string[] = []
  const pdf = r.pdf
  lines.push(
    pdf
      ? p.pdfSource(pdf.pages, pdf.tablePages[0], pdf.tablePages[1])
      : r.source === "excel"
        ? p.excelSource(r.sheet ?? "")
        : p.csvSource(p.encodings[r.encoding ?? ""] ?? r.encoding ?? "", p.delimiters[r.delimiter ?? ""] ?? r.delimiter ?? ""),
  )
  if (pdf && pdf.ocrPages > 0) lines.push(p.ocrPages(pdf.ocrPages))
  if (pdf && pdf.skippedOcrPages > 0) lines.push(p.ocrSkipped(pdf.skippedOcrPages))
  if (pdf && pdf.checkedCells > 0) lines.push(p.ocrChecked(pdf.checkedCells, pdf.correctedCells))
  if (pdf && pdf.droppedPageFurniture > 0) lines.push(p.pageFurniture(pdf.droppedPageFurniture))
  if (r.filledMergedCells > 0) lines.push(p.mergedCells(r.filledMergedCells))
  if (r.hiddenRows > 0) lines.push(p.hiddenRows(r.hiddenRows))
  lines.push(r.headerRow > 0 ? p.header(r.headerRow) : p.noHeader)
  if (r.droppedRepeatedHeaders > 0) lines.push(p.repeatedHeaders(r.droppedRepeatedHeaders))
  if (pdf && pdf.mergedWrappedRows > 0) lines.push(p.wrappedRows(pdf.mergedWrappedRows))
  if (r.skippedTopRows > 0) lines.push(p.skipped(r.skippedTopRows))
  if (r.droppedEmptyRows > 0) lines.push(p.emptyRows(r.droppedEmptyRows))
  if (r.droppedEmptyColumns > 0) lines.push(p.emptyColumns(r.droppedEmptyColumns))
  if (r.droppedTotalRows.length > 0) lines.push(p.totals(r.droppedTotalRows.map((l) => `“${l}”`).join(", ")))

  const renamed = r.renamedColumns.filter((c) => c.from.trim() !== "" || c.to !== "")
  const originals = new Map(r.renamedColumns.map((c) => [c.to, c.from]))
  const converted = dataset.cleaned.map((c) => {
    const kind = (t.dataset.cleanNotes as Partial<Record<string, string>>)[c.kind]
    return `${c.column}: ${[kind, c.currencyStripped ? t.dataset.currencyStripped : null].filter(Boolean).join("; ")}`
  })
  const structural =
    r.skippedTopRows +
    r.droppedEmptyRows +
    r.droppedEmptyColumns +
    r.droppedTotalRows.length +
    r.droppedRepeatedHeaders +
    r.filledMergedCells +
    r.hiddenRows +
    (pdf ? pdf.droppedPageFurniture + pdf.mergedWrappedRows + pdf.ocrPages : 0)

  const columns: OutputColumn[] = dataset.columns.map((c) => ({ key: c.name, label: c.name, format: FORMAT[c.type] ?? "text", total: false }))
  const preview: Extract<ResultView, { kind: "table" }> = {
    kind: "table",
    columns,
    rows: dataset.preview,
    rowCount: dataset.preview.length,
    truncated: false,
    partial: false,
    totals: {},
  }

  return (
    <Card className="py-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="py-3">
          <CollapsibleTrigger className="group/prep flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <span className="inline-flex items-center gap-1.5">
              <ClipboardCheck className="size-4 text-primary" aria-hidden /> {p.title}
            </span>
            <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]/prep:rotate-180" aria-hidden />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4 pb-5 text-sm">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground marker:text-primary">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
              {structural === 0 && <li>{p.clean}</li>}
              <li className="text-foreground">{p.result(formatCount(dataset.rowCount, locale), dataset.columns.length)}</li>
              {dataset.ambiguous.map((column) => (
                <li key={`amb-${column}`} className="inline-flex items-start gap-1.5 text-foreground marker:text-transparent">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {p.ambiguous(column)}
                </li>
              ))}
              {dataset.unreadable.map((u) => (
                <li key={u.column} className="inline-flex items-start gap-1.5 text-foreground marker:text-transparent">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {p.unreadable(u.column, u.count)}
                </li>
              ))}
              {pdf && pdf.uncertainCells > 0 && (
                <li className="inline-flex items-start gap-1.5 text-foreground marker:text-transparent">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {p.ocrUncertain(pdf.uncertainCells)}
                </li>
              )}
              {pdf && pdf.ocrPages > 0 && (
                <li className="inline-flex items-start gap-1.5 text-foreground marker:text-transparent">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {p.ocrWarning(pdf.lowConfidenceWords)}
                </li>
              )}
            </ul>
            {renamed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">{p.renamed}</span>
                <ul className="flex flex-wrap gap-1.5">
                  {renamed.map((c) => (
                    <li key={c.to} className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs">
                      {c.from ? `${c.from} → ` : ""}
                      <span className="text-primary">{c.to}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {converted.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">{p.converted}</span>
                <ul className="flex flex-col gap-1 font-mono text-xs">
                  {converted.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {dataset.profile.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">{p.profileTitle}</span>
                <ColumnSummaryTable profile={dataset.profile} rowCount={dataset.rowCount} originals={originals} />
              </div>
            )}
            {dataset.linked.map((l) => (
              <div key={l.table} className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">
                  {p.linkedTitle(l.table, l.fileName, formatCount(l.rowCount, locale))}
                </span>
                <ColumnSummaryTable
                  profile={l.profile}
                  rowCount={l.rowCount}
                  originals={new Map(l.report.renamedColumns.map((c) => [c.to, c.from]))}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">{p.previewTitle(dataset.preview.length)}</span>
              <TableView view={preview} />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/** Per-column summary of one table: type, filled share, distinct values, range or top values. */
function ColumnSummaryTable({
  profile,
  rowCount,
  originals,
}: {
  profile: Dataset["profile"]
  rowCount: number
  originals: ReadonlyMap<string, string>
}) {
  const { t, locale } = useI18n()
  const p = t.prep
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>{p.profileCols.column}</TableHead>
            <TableHead>{p.profileCols.type}</TableHead>
            <TableHead className="text-right">{p.profileCols.filled}</TableHead>
            <TableHead className="text-right">{p.profileCols.distinct}</TableHead>
            <TableHead>{p.profileCols.values}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profile.map((c) => {
            const fmt = c.type === "number" ? "number" : c.type === "date" ? "date" : "text"
            const values =
              c.type === "text"
                ? c.top.map((v) => p.topValue(v.value, formatCount(v.count, locale))).join(" · ")
                : c.min !== null && c.max !== null
                  ? p.range(formatValue(c.min, fmt, false, locale), formatValue(c.max, fmt, false, locale))
                  : "—"
            return (
              <TableRow key={c.name}>
                <TableCell className="font-mono text-xs" title={originals.get(c.name) ?? c.name}>
                  {c.name}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.types[c.type]}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatRatio(rowCount > 0 ? c.filled / rowCount : 0, locale)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatCount(c.distinct, locale)}</TableCell>
                <TableCell className="max-w-[28rem] truncate" title={values}>
                  {values}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

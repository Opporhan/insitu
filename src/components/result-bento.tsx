"use client"

import { useRef, useState } from "react"
import { Check, ChevronDown, ClipboardCopy, Code2, FileImage, FileText, Sparkles } from "lucide-react"
import { ChartView } from "@/components/chart-view"
import { useI18n } from "@/components/i18n-provider"
import { MetricView } from "@/components/metric-view"
import { TableView } from "@/components/table-view"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { copyTable, downloadCsv, downloadPng } from "@/lib/export"
import { formatCount } from "@/lib/format"
import { buildInsight } from "@/lib/insight"
import type { ResultView } from "@/lib/result-view"
import type { Column, OutputColumn, QueryPlan, ResultRow } from "@/lib/schema"

export type Answer = {
  question: string
  plan: QueryPlan
  /** Full query result, used for the CSV export. */
  rows: ResultRow[]
  resultColumns: OutputColumn[]
  view: ResultView
}

function ResultBody({ view }: { view: ResultView }) {
  const { t } = useI18n()
  switch (view.kind) {
    case "empty":
      return <p className="py-10 text-center text-sm text-muted-foreground">{t.result.empty}</p>
    case "metric":
      return <MetricView view={view} />
    case "table":
      return <TableView view={view} />
    default:
      return <ChartView view={view} />
  }
}

type Props = {
  answer: Answer
  columns: readonly Column[]
  rowCount: number
}

function slug(s: string): string {
  return s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "insitu"
}

export function ResultBento({ answer, columns, rowCount }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const { t, locale } = useI18n()
  const { question, plan, rows, resultColumns, view } = answer
  // Computed per render so switching the language updates it immediately.
  const insight = buildInsight(view, locale)
  const fileName = `insitu-${slug(question)}`
  const [status, setStatus] = useState<"idle" | "exporting" | "copied" | "error">("idle")

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
          <ResultBody view={view} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardDescription className="inline-flex items-center gap-1.5 text-primary">
              <Sparkles className="size-4" aria-hidden /> {t.result.insight}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg leading-relaxed text-pretty">{insight}</p>
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
              disabled={status === "exporting"}
              onClick={() => void run(() => (chartRef.current ? downloadPng(chartRef.current, fileName) : undefined))}
            >
              <FileImage aria-hidden /> PNG
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={rows.length === 0}
              onClick={() => void run(() => downloadCsv(resultColumns, rows, fileName, locale))}
            >
              <FileText aria-hidden /> CSV
            </Button>
            <Button
              variant="outline"
              className="col-span-2 h-11"
              disabled={rows.length === 0 || status === "exporting"}
              onClick={() => void run(() => copyTable(resultColumns, rows, locale), "copied")}
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
                <p className="text-muted-foreground">{t.result.howSent(columns.length)}</p>
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
    </section>
  )
}

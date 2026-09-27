"use client"

import { AlertTriangle, ChevronDown, ChevronRight, Lightbulb } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { Dataset } from "@/lib/engine/load-file"
import type { Finding, Measure, Warning } from "@/lib/engine/overview"
import { formatCount, formatRatio, formatValue } from "@/lib/format"
import { humanize } from "@/lib/suggestions"

type Props = {
  dataset: Dataset
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  onAsk: (question: string) => void
}

type Item = { text: string; question: string }

/** Findings computed right after loading; each one asks its question to show the chart. */
export function OverviewPanel({ dataset, open, onOpenChange, busy, onAsk }: Props) {
  const { t, locale } = useI18n()
  const o = t.overview
  const s = t.suggestions
  const originals = new Map(dataset.report.renamedColumns.map((c) => [c.to, c.from]))
  const label = (name: string) => humanize(name, originals.get(name), locale)
  const money = (v: number, m: Measure | null) => formatValue(v, m?.format ?? "integer", false, locale)
  const count = (n: number) => formatCount(n, locale)
  const month = (ym: string) => formatValue(ym, "month", false, locale)
  const signed = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${formatRatio(Math.abs(r), locale)}`
  const { measure } = dataset.overview
  const total = measure ? s.total(label(measure.name)) : null
  const trendQuestion = total ? s.trend(total) : s.countTrend

  const finding = (f: Finding): Item => {
    switch (f.kind) {
      case "total":
        return {
          text: f.measure && f.total !== null ? o.totalWith(count(f.rows), label(f.measure.name), money(f.total, f.measure)) : o.total(count(f.rows)),
          question: total ? o.askTotal(total) : o.askCount,
        }
      case "top":
        return {
          text: o.top(label(f.dim), f.value, formatRatio(f.share, locale), money(f.amount, f.measure)),
          question: total ? s.share(total, label(f.dim)) : s.countShare(label(f.dim)),
        }
      case "bestMonth":
        return { text: o.bestMonth(month(f.month), money(f.amount, f.measure)), question: trendQuestion }
      case "trend":
        return { text: o.trend(month(f.from), month(f.to), signed(f.change)), question: trendQuestion }
      case "status":
        return { text: o.status(f.value, formatRatio(f.share, locale), count(f.rows)), question: s.countShare(label(f.column)) }
    }
  }

  const warning = (w: Warning): Item => {
    switch (w.kind) {
      case "outliers":
        return {
          text: o.outliers(label(w.measure.name), count(w.count), money(w.max, w.measure), money(w.median, w.measure)),
          question: o.askTop(label(w.measure.name)),
        }
      case "monthSpike":
        return { text: o.monthSpike(month(w.month), w.high, money(w.amount, w.measure), money(w.median, w.measure)), question: trendQuestion }
      case "negatives":
        return { text: o.negatives(label(w.measure.name), count(w.count)), question: o.askNegatives(label(w.measure.name)) }
      case "duplicates":
        return { text: o.duplicates(count(w.count)), question: o.askDuplicates }
    }
  }

  const findings = dataset.overview.findings.map(finding)
  const warnings = dataset.overview.warnings.map(warning)
  if (findings.length === 0 && warnings.length === 0) return null

  const row = (item: Item, Icon: typeof Lightbulb) => (
    <li key={item.text}>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAsk(item.question)}
        title={o.askHint(item.question)}
        className="group/item flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span className="flex-1 text-pretty">{item.text}</span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover/item:translate-x-0.5" aria-hidden />
      </button>
    </li>
  )

  return (
    <Card className="py-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="py-3">
          <CollapsibleTrigger className="group/ov flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="size-4 text-primary" aria-hidden /> {o.title}
              {warnings.length > 0 && <span className="rounded-full border px-2 text-xs">{o.warningCount(warnings.length)}</span>}
            </span>
            <ChevronDown className="size-4 transition-transform duration-200 group-data-[state=open]/ov:rotate-180" aria-hidden />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4 pb-5 text-sm">
            <p className="text-xs text-muted-foreground">{o.subtitle}</p>
            <ul className="flex flex-col gap-0.5">{findings.map((f) => row(f, Lightbulb))}</ul>
            {warnings.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">{o.warningsTitle}</span>
                <ul className="flex flex-col gap-0.5">{warnings.map((w) => row(w, AlertTriangle))}</ul>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

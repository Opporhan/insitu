"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FileDown, Loader2, X } from "lucide-react"
import { ChartView } from "@/components/chart-view"
import { useI18n } from "@/components/i18n-provider"
import { MetricView } from "@/components/metric-view"
import { TableView } from "@/components/table-view"
import { Button } from "@/components/ui/button"
import { downloadBytes, renderPng } from "@/lib/export"
import type { ReportImage } from "@/lib/report-pdf"
import { pngPages, type ResultView } from "@/lib/result-view"

/** A snapshot of an answer as it looked when added: the chosen view, its texts. */
export type ReportItem = {
  id: number
  title: string
  question: string
  insight: string
  notes: string[]
  view: Exclude<ResultView, { kind: "empty" }>
}

/** Off-screen card width; wide enough for bar labels, same for every page of the report. */
const CAPTURE_WIDTH = 960

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Waits until Recharts has drawn shapes with a real size (it measures its container first). */
async function chartDrawn(node: HTMLElement): Promise<void> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    const shapes = node.querySelectorAll(".recharts-bar-rectangle path, .recharts-sector, .recharts-line-curve, .recharts-area-area")
    const sized = [...shapes].some((s) => (s as SVGGraphicsElement).getBBox?.().width > 0)
    if (sized) break
    await new Promise((r) => setTimeout(r, 50))
  }
  await nextFrame()
  await nextFrame()
}

/** Renders one item off-screen (light theme, no animation) and reports its page images. */
function Capture({ item, onDone }: { item: ReportItem; onDone: (images: ReportImage[] | Error) => void }) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  const view = item.view
  // Fewer rows per PDF page than in PNG exports, so the table prints at a readable size.
  const pages = view.kind === "table" ? pngPages(view.rows.length, 16) : [[0, 0] as [number, number]]

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const root = pagesRef.current
        if (!root) throw new Error("capture root missing")
        if (view.kind === "bar" || view.kind === "line" || view.kind === "pie") await chartDrawn(root)
        else {
          await nextFrame()
          await nextFrame()
        }
        const images: ReportImage[] = []
        for (const node of [...root.children] as HTMLElement[]) {
          const { width, height } = node.getBoundingClientRect()
          const blob = await renderPng(node, 2)
          images.push({ png: new Uint8Array(await blob.arrayBuffer()), width, height })
        }
        if (!cancelled) done.current(images)
      } catch (e) {
        if (!cancelled) done.current(e instanceof Error ? e : new Error(String(e)))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view])

  return createPortal(
    <div aria-hidden className="theme-light" style={{ position: "fixed", top: 0, left: -100_000, width: CAPTURE_WIDTH }}>
      <div ref={pagesRef} className="flex flex-col gap-4">
        {pages.map(([start, end], i) => (
          <div key={i} className="bg-card p-6 text-card-foreground">
            {view.kind === "table" ? (
              <TableView view={view} rows={view.rows.slice(start, end)} scroll={false} showTotals={i === pages.length - 1} />
            ) : view.kind === "metric" ? (
              <MetricView view={view} />
            ) : (
              <ChartView view={view} still />
            )}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

type Props = {
  items: readonly ReportItem[]
  fileName: string
  onRemove: (id: number) => void
  onClear: () => void
}

/** The report being collected: its analyses, and the PDF download. */
export function ReportBar({ items, fileName, onRemove, onClear }: Props) {
  const { t, locale } = useI18n()
  const r = t.report
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "working"; done: number } | { kind: "error" }>({ kind: "idle" })
  const [capturing, setCapturing] = useState<{ item: ReportItem; resolve: (v: ReportImage[] | Error) => void } | null>(null)

  if (items.length === 0) return null

  const capture = (item: ReportItem) => new Promise<ReportImage[] | Error>((resolve) => setCapturing({ item, resolve }))

  async function download() {
    setStatus({ kind: "working", done: 0 })
    try {
      const entries = []
      for (const [i, item] of items.entries()) {
        const images = await capture(item)
        setCapturing(null)
        if (images instanceof Error) throw images
        entries.push({ title: item.title, question: item.question, insight: item.insight, notes: item.notes, images })
        setStatus({ kind: "working", done: i + 1 })
      }
      const [{ buildReportPdf }, regular, bold] = await Promise.all([
        import("@/lib/report-pdf"),
        fetch("/fonts/NotoSans-Regular.ttf").then((res) => res.arrayBuffer()),
        fetch("/fonts/NotoSans-Bold.ttf").then((res) => res.arrayBuffer()),
      ])
      const date = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "long", timeStyle: "short" }).format(new Date())
      const pdf = await buildReportPdf(
        entries,
        {
          coverTitle: r.coverTitle,
          coverSubtitle: r.coverSubtitle(fileName, date, items.length),
          contents: r.contents,
          footer: r.footer,
          page: r.page,
          continued: r.continued,
          pageRef: r.pageRef,
        },
        { regular, bold },
        `${r.coverTitle} — ${fileName}`,
      )
      const base = fileName.replace(/\.[^.]+$/, "")
      downloadBytes(pdf, `${r.fileName(base)}.pdf`, "application/pdf")
      setStatus({ kind: "idle" })
    } catch {
      setCapturing(null)
      setStatus({ kind: "error" })
    }
  }

  const working = status.kind === "working"
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FileDown className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 text-muted-foreground" aria-live="polite">
          {working ? r.working(status.done, items.length) : status.kind === "error" ? r.failed : r.summary(items.length)}
        </span>
        <Button className="h-11 px-4" disabled={working} onClick={() => void download()}>
          {working ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />} {r.download}
        </Button>
        <Button variant="ghost" className="h-11 px-3" disabled={working} onClick={onClear}>
          {r.clear}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <li key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background py-0.5 pr-1 pl-3 text-xs">
            <span className="truncate">
              {i + 1}. {item.title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="-my-2 size-11 shrink-0 rounded-full"
              disabled={working}
              aria-label={r.remove(item.title)}
              onClick={() => onRemove(item.id)}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {capturing && <Capture key={capturing.item.id} item={capturing.item} onDone={capturing.resolve} />}
    </div>
  )
}

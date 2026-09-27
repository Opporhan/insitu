"use client"

import { ChartColumn, ChartLine, ChartPie, ChevronRight, Hash, History, Table2 } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import type { Answer } from "@/components/result-bento"
import { buildInsight } from "@/lib/insight"

const ICONS = { metric: Hash, bar: ChartColumn, line: ChartLine, pie: ChartPie, table: Table2, empty: Table2 } as const

type Props = { answers: readonly Answer[]; onSelect: (id: number) => void }

/** Earlier answers of this session, newest first; one click brings an answer back in full. */
export function AnswerHistory({ answers, onSelect }: Props) {
  const { t, locale } = useI18n()
  if (answers.length === 0) return null
  return (
    <section aria-label={t.history.title} className="flex flex-col gap-3">
      <h2 className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <History className="size-4 text-primary" aria-hidden />
        {t.history.title}
        <span className="font-normal">· {t.history.count(answers.length)}</span>
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {answers.map((a) => {
          const Icon = ICONS[a.view.kind]
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                aria-label={`${t.history.show}: ${a.plan.title}`}
                className="group flex min-h-11 w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors duration-150 hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{a.plan.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{a.question}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground/80">{buildInsight(a.view, locale)}</span>
                </span>
                <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

"use client"

import { useI18n } from "@/components/i18n-provider"
import { formatValue } from "@/lib/format"
import type { ResultView } from "@/lib/result-view"
import { cn } from "@/lib/utils"

export function MetricView({ view }: { view: Extract<ResultView, { kind: "metric" }> }) {
  const { locale } = useI18n()
  const [primary, ...rest] = view.items
  if (!primary) return null
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{primary.column.label}</span>
        <span className="font-mono text-4xl font-semibold tracking-tight tabular-nums text-primary sm:text-5xl">
          {formatValue(primary.value, primary.column.format, false, locale)}
        </span>
      </div>
      {rest.length > 0 && (
        <dl className={cn("grid gap-3", rest.length > 1 && "sm:grid-cols-2")}>
          {rest.map((item) => (
            <div key={item.column.key} className="rounded-lg border bg-background px-4 py-3">
              <dt className="text-xs text-muted-foreground">{item.column.label}</dt>
              <dd className="font-mono text-xl font-medium tabular-nums">{formatValue(item.value, item.column.format, false, locale)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

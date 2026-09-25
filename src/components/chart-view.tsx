"use client"

import { useEffect, useRef } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts"
import { useI18n } from "@/components/i18n-provider"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { formatRatio, formatValue } from "@/lib/format"
import type { Locale } from "@/lib/i18n"
import type { OutputColumn, ResultValue } from "@/lib/schema"
import type { ResultView, Series } from "@/lib/result-view"

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"] as const

/**
 * SVG colors are set directly on each element, never through CSS classes: the PNG
 * exporter (html-to-image) copies SVG markup as-is, so class-based colors are lost
 * and Recharts' defaults (#808080 labels, #ccc grid) would appear in the image.
 */
const INK = { strong: "var(--foreground)", muted: "var(--muted-foreground)", grid: "var(--border)" } as const
const STRONG_TICK = { fill: INK.strong, style: { fill: INK.strong } }
const MUTED_TICK = { fill: INK.muted, style: { fill: INK.muted } }

/** If an animation-end event never arrives (e.g. a background tab), still unlock export. */
const READY_FALLBACK_MS = 4000

export function seriesColor(i: number): string {
  return PALETTE[i % PALETTE.length] ?? PALETTE[0]
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function seriesConfig(series: readonly Series[]): ChartConfig {
  return Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: seriesColor(i) }]))
}

type TooltipEntry = { dataKey?: unknown; value?: unknown; color?: string; payload?: unknown }
type TooltipProps = { active?: boolean; payload?: readonly TooltipEntry[]; label?: unknown }

function TooltipBox({ title, rows }: { title: string; rows: { color: string; name: string; value: string }[] }) {
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl">
      <div className="font-medium text-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: r.color }} aria-hidden />
          <span className="flex-1 text-muted-foreground">{r.name}</span>
          <span className="font-mono font-medium text-foreground tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Tooltip that formats with the column's declared format (₺, %, dates) instead of toLocaleString. */
function XYTooltip({
  active,
  payload,
  label,
  x,
  y,
  series,
  locale,
}: TooltipProps & { x: OutputColumn; y: OutputColumn; series: readonly Series[]; locale: Locale }) {
  if (!active || !payload?.length) return null
  const names = new Map(series.map((s) => [s.key, s.label]))
  const rows = payload.flatMap((p) => {
    const key = String(p.dataKey)
    const v = p.value
    if (typeof v !== "number") return []
    return [{ color: p.color ?? "var(--chart-1)", name: names.get(key) ?? key, value: formatValue(v, y.format, false, locale) }]
  })
  return <TooltipBox title={formatValue((label ?? null) as ResultValue, x.format, false, locale)} rows={rows} />
}

function PieTooltip({ active, payload, value, locale }: TooltipProps & { value: OutputColumn; locale: Locale }) {
  const entry = payload?.[0]
  if (!active || !entry) return null
  const slice = entry.payload as { name: string; value: number; share: number; fill?: string }
  return (
    <TooltipBox
      title={slice.name}
      rows={[
        {
          color: slice.fill ?? "var(--chart-1)",
          name: formatRatio(slice.share, locale),
          value: formatValue(slice.value, value.format, false, locale),
        },
      ]}
    />
  )
}

type Props = {
  view: Extract<ResultView, { kind: "bar" | "line" | "pie" }>
  /** Called once every series has finished drawing, so an export never catches a half-drawn chart. */
  onReady?: () => void
}

export function ChartView({ view, onReady }: Props) {
  const { t, locale } = useI18n()
  const animate = !prefersReducedMotion()
  const seriesCount = view.kind === "pie" ? 1 : view.series.length
  const finished = useRef(0)
  const readyRef = useRef(onReady)
  useEffect(() => {
    readyRef.current = onReady
  })

  useEffect(() => {
    if (!animate) {
      readyRef.current?.()
      return
    }
    const timer = setTimeout(() => readyRef.current?.(), READY_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [animate])

  const onAnimationEnd = () => {
    finished.current += 1
    if (finished.current >= seriesCount) readyRef.current?.()
  }

  if (view.kind === "pie") {
    const config: ChartConfig = Object.fromEntries(view.slices.map((s, i) => [s.name, { label: s.name, color: seriesColor(i) }]))
    const data = view.slices.map((s, i) => ({ ...s, fill: seriesColor(i) }))
    return (
      <div className="flex flex-col gap-4">
        <ChartContainer config={config} className="mx-auto aspect-square h-[300px] w-full max-w-[300px]">
          <PieChart accessibilityLayer>
            <ChartTooltip content={<PieTooltip value={view.value} locale={locale} />} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="100%"
              strokeWidth={2}
              stroke="var(--card)"
              isAnimationActive={animate}
              onAnimationEnd={onAnimationEnd}
            >
              {data.map((s) => (
                <Cell key={s.name} fill={s.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="grid gap-2 text-sm sm:grid-cols-2" aria-label={t.result.slices}>
          {data.map((s) => (
            <li key={s.name} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.fill }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{formatRatio(s.share, locale)}</span>
              <span className="w-28 text-right font-mono tabular-nums">{formatValue(s.value, view.value.format, false, locale)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const { x, y, series, data } = view
  const config = seriesConfig(series)
  const multi = series.length > 1
  const tooltip = <ChartTooltip cursor={view.kind === "line"} content={<XYTooltip x={x} y={y} series={series} locale={locale} />} />
  const legend = multi ? <ChartLegend content={<ChartLegendContent />} /> : null
  const tick = (v: unknown) => formatValue((v ?? null) as ResultValue, y.format, true, locale)
  const xTick = (v: unknown) => truncate(formatValue((v ?? null) as ResultValue, x.format, true, locale), 26)

  if (view.kind === "bar") {
    const longest = Math.max(...data.map((d) => xTick(d.x).length))
    const rowHeight = multi ? 18 * series.length + 18 : 40
    return (
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(220, data.length * rowHeight + (multi ? 56 : 24)) }}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: multi ? 16 : 84 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <YAxis
            dataKey="x"
            type="category"
            tickLine={false}
            axisLine={false}
            width={Math.min(190, Math.max(56, longest * 7 + 8))}
            tickFormatter={xTick}
            interval={0}
            // Category names are the content here, not scaffolding: full-contrast text.
            tick={STRONG_TICK}
          />
          <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={tick} tick={MUTED_TICK} hide={!multi} />
          {tooltip}
          {legend}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={4} isAnimationActive={animate} onAnimationEnd={onAnimationEnd}>
              {!multi && (
                <LabelList
                  dataKey={s.key}
                  position="right"
                  fill={INK.strong}
                  style={{ fill: INK.strong }}
                  formatter={(v: unknown) => (typeof v === "number" ? formatValue(v, y.format, false, locale) : "")}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    )
  }

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={INK.grid} />
      <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={xTick} tick={MUTED_TICK} />
      <YAxis tickLine={false} axisLine={false} width={76} tickFormatter={tick} tick={MUTED_TICK} />
    </>
  )
  if (multi) {
    return (
      <ChartContainer config={config} className="aspect-auto h-[380px] w-full">
        <LineChart data={data} margin={{ left: 4, right: 16, top: 8 }} accessibilityLayer>
          {axes}
          {tooltip}
          {legend}
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={animate}
              onAnimationEnd={onAnimationEnd}
            />
          ))}
        </LineChart>
      </ChartContainer>
    )
  }
  return (
    <ChartContainer config={config} className="aspect-auto h-[360px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 16, top: 8 }} accessibilityLayer>
        {axes}
        {tooltip}
        <Area
          dataKey="s0"
          type="monotone"
          stroke="var(--color-s0)"
          strokeWidth={2}
          fill="var(--color-s0)"
          fillOpacity={0.2}
          // Explicit dot colors: the container's class-based dot styling does not reach the PNG.
          dot={data.length <= 24 ? { fill: "var(--card)", stroke: "var(--color-s0)", strokeWidth: 2 } : false}
          isAnimationActive={animate}
          onAnimationEnd={onAnimationEnd}
        />
      </AreaChart>
    </ChartContainer>
  )
}

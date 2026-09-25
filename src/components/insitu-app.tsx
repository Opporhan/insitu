"use client"

import { useState } from "react"
import { FileSpreadsheet, X } from "lucide-react"
import { AskBar } from "@/components/ask-bar"
import { Dropzone } from "@/components/dropzone"
import { useI18n } from "@/components/i18n-provider"
import { ResultBento, type Answer } from "@/components/result-bento"
import { Button } from "@/components/ui/button"
import { isAccepted, loadFile, type Dataset } from "@/lib/engine/load-file"
import { runQuery } from "@/lib/engine/run-query"
import { formatCount } from "@/lib/format"
import { resolveColumns, resolveView } from "@/lib/result-view"
import { TranslateResponse, type RepairContext, type TranslateRequest } from "@/lib/schema"
import { suggestQuestions } from "@/lib/suggestions"

type AnswerState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "error"; message: string; suggestions: string[] }
  | { kind: "done"; answer: Answer }

const SAMPLE_URL = "/samples/satislar.csv"

/** Read ➔ Translate ➔ Run ➔ Draw. Row data stays inside this component tree. */
export function InsituApp() {
  const { t, locale } = useI18n()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [state, setState] = useState<AnswerState>({ kind: "idle" })

  async function openFile(file: File) {
    if (!isAccepted(file.name)) {
      setFileError(t.file.unsupported)
      return
    }
    setFileLoading(true)
    setFileError(null)
    try {
      setDataset(await loadFile(file))
      setState({ kind: "idle" })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setFileError(t.file.readFailed(t.file.codes[detail] ?? detail))
    } finally {
      setFileLoading(false)
    }
  }

  async function openSample() {
    const res = await fetch(SAMPLE_URL)
    await openFile(new File([await res.blob()], "satislar.csv", { type: "text/csv" }))
  }

  async function translate(payload: TranslateRequest): Promise<TranslateResponse | null> {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null)
    const parsed = TranslateResponse.safeParse(res ? await res.json().catch(() => null) : null)
    return parsed.success ? parsed.data : null
  }

  async function ask(question: string) {
    if (!dataset) return
    setState({ kind: "asking" })

    let repair: RepairContext | undefined
    // One run plus one repair round for structural SQL errors (unknown column, syntax…).
    for (let attempt = 0; attempt < 2; attempt++) {
      // The only data that leaves the browser: the question, column headers and, on a
      // repair, the generated SQL with a masked structural error message.
      const payload: TranslateRequest = repair
        ? { question, columns: dataset.columns, repair, locale }
        : { question, columns: dataset.columns, locale }
      const translated = await translate(payload)
      if (!translated) {
        setState({ kind: "error", message: t.ask.translateFailed, suggestions: [] })
        return
      }
      if (!translated.ok) {
        setState({ kind: "error", message: translated.error, suggestions: translated.suggestions })
        return
      }

      const plan = translated.plan
      const result = await runQuery(plan.sql)
      if (!result.ok) {
        if (attempt === 0 && result.repairable) {
          repair = { sql: plan.sql, error: result.repairable }
          continue
        }
        setState({
          kind: "error",
          message: t.ask.computeFailed(result.error),
          suggestions: suggestQuestions(dataset.columns, locale),
        })
        return
      }

      const view = resolveView(plan, result.rows, result.columns, result.complete, t.insight.other)
      const resultColumns = resolveColumns(plan.columns, result.columns, result.rows)
      setState({ kind: "done", answer: { question, plan, rows: result.rows, resultColumns, view } })
      return
    }
  }

  if (!dataset) {
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t.hero.title}</h1>
          <p className="mx-auto max-w-[60ch] text-base text-pretty text-muted-foreground">{t.hero.body}</p>
        </div>
        <Dropzone loading={fileLoading} error={fileError} onFile={openFile} onSample={openSample} />
      </div>
    )
  }

  const busy = state.kind === "asking"
  const suggestions =
    state.kind === "idle" ? suggestQuestions(dataset.columns, locale) : state.kind === "error" ? state.suggestions : []
  const cleanedNotes = dataset.cleaned.map(
    (c) =>
      `${c.column}: ${[(t.dataset.cleanNotes as Partial<Record<string, string>>)[c.kind], c.currencyStripped ? t.dataset.currencyStripped : null]
        .filter(Boolean)
        .join("; ")}`,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileSpreadsheet className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate font-medium text-foreground">{dataset.fileName}</span>
          <span className="shrink-0">· {t.dataset.summary(formatCount(dataset.rowCount, locale), dataset.columns.length)}</span>
        </span>
        {cleanedNotes.length > 0 && (
          <span
            className="hidden shrink-0 rounded-md border px-2 py-0.5 text-xs text-primary sm:inline"
            title={cleanedNotes.join("\n")}
          >
            {t.dataset.cleaned(cleanedNotes.length)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          aria-label={t.dataset.close}
          onClick={() => {
            setDataset(null)
            setState({ kind: "idle" })
          }}
        >
          <X aria-hidden />
        </Button>
      </div>

      <AskBar busy={busy} suggestions={suggestions} onAsk={ask} />

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {busy && <div className="h-96 animate-pulse rounded-xl border bg-card" aria-label={t.ask.computing} />}

      {state.kind === "done" && (
        <ResultBento answer={state.answer} columns={dataset.columns} rowCount={dataset.rowCount} />
      )}
    </div>
  )
}

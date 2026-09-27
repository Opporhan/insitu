"use client"

import { useEffect, useRef, useState } from "react"
import { FileSpreadsheet, MessagesSquare, RotateCcw, X } from "lucide-react"
import { AnswerHistory } from "@/components/answer-history"
import { AskBar } from "@/components/ask-bar"
import { DataPrepPanel } from "@/components/data-prep-panel"
import { Dropzone } from "@/components/dropzone"
import { useI18n } from "@/components/i18n-provider"
import { ResultBento, type Answer } from "@/components/result-bento"
import { SheetSelector } from "@/components/sheet-selector"
import { Button } from "@/components/ui/button"
import { isAccepted, loadFile, type Dataset } from "@/lib/engine/load-file"
import { prewarmDb } from "@/lib/engine/duckdb"
import { runQuery } from "@/lib/engine/run-query"
import { formatCount } from "@/lib/format"
import type { SheetInfo } from "@/lib/ingest"
import { resolveColumns, resolveView } from "@/lib/result-view"
import { MAX_HISTORY, TranslateResponse, type HistoryTurn, type RepairContext, type TranslateRequest } from "@/lib/schema"
import { suggestQuestions } from "@/lib/suggestions"

type AnswerState = { kind: "idle" } | { kind: "asking" } | { kind: "error"; message: string; suggestions: string[] }

/** Answers kept in the session history (newest first). */
const MAX_ANSWERS = 20

const SAMPLE_URL = "/samples/satislar.csv"

/** Read ➔ Translate ➔ Run ➔ Draw. Row data stays inside this component tree. */
export function InsituApp() {
  const { t, locale } = useI18n()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [state, setState] = useState<AnswerState>({ kind: "idle" })
  // Every answer of this file's session stays available; one is shown in full.
  const [answers, setAnswers] = useState<Answer[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const answerCount = useRef(0)
  // Earlier questions + their SQL, so follow-ups ("and how many units?") keep the context.
  const [history, setHistory] = useState<HistoryTurn[]>([])
  // Workbook with several sheets: the user picks one before anything is loaded.
  const [sheetChoice, setSheetChoice] = useState<{ file: File; sheets: SheetInfo[] } | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [prepOpen, setPrepOpen] = useState(true)

  // Fetch and start the in-browser engine while the user is still choosing a file.
  useEffect(() => prewarmDb(), [])

  async function openFile(file: File, sheet?: string) {
    if (!isAccepted(file.name)) {
      setFileError(t.file.unsupported)
      return
    }
    setFileLoading(true)
    setFileError(null)
    try {
      const loaded = await loadFile(file, sheet)
      if (loaded.kind === "sheets") {
        setSheetChoice({ file, sheets: loaded.sheets })
        return
      }
      setSheetChoice(null)
      setSourceFile(file)
      setDataset(loaded.dataset)
      setState({ kind: "idle" })
      setAnswers([])
      setActiveId(null)
      setHistory([])
      setPrepOpen(true)
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
      const payload: TranslateRequest = {
        question,
        columns: dataset.columns,
        locale,
        ...(repair ? { repair } : {}),
        ...(history.length > 0 ? { history } : {}),
      }
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
          suggestions: [],
        })
        return
      }

      const view = resolveView(plan, result.rows, result.columns, result.complete, t.insight.other)
      const resultColumns = resolveColumns(plan.columns, result.columns, result.rows)
      const answer: Answer = {
        id: ++answerCount.current,
        question,
        plan,
        rows: result.rows,
        complete: result.complete,
        resultColumns,
        view,
        contextTurns: history.length,
      }
      setAnswers((prev) => [answer, ...prev].slice(0, MAX_ANSWERS))
      setActiveId(answer.id)
      setState({ kind: "idle" })
      setHistory([...history, { question, sql: plan.sql }].slice(-MAX_HISTORY))
      // The prep report has done its job once the user is asking questions; keep it one click away.
      setPrepOpen(false)
      return
    }
  }

  if (sheetChoice) {
    return (
      <SheetSelector
        fileName={sheetChoice.file.name}
        sheets={sheetChoice.sheets}
        loading={fileLoading}
        onPick={(sheet) => void openFile(sheetChoice.file, sheet)}
        onCancel={() => setSheetChoice(null)}
      />
    )
  }

  if (!dataset) {
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t.hero.title}</h1>
          <p className="mx-auto max-w-[60ch] text-base text-pretty text-muted-foreground">{t.hero.body}</p>
        </div>
        <Dropzone loading={fileLoading} error={fileError} onFile={(file) => void openFile(file)} onSample={openSample} />
      </div>
    )
  }

  const busy = state.kind === "asking"
  const active = answers.find((a) => a.id === activeId)

  function showAnswer(id: number) {
    const answer = answers.find((a) => a.id === id)
    if (!answer) return
    setActiveId(id)
    // A follow-up now refers to the answer on screen, not to the most recently asked one.
    setHistory([{ question: answer.question, sql: answer.plan.sql }])
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }))
  }
  const suggestions =
    // Built here (not taken from the server) so they use the file's original headers and the current language.
    state.kind === "error" || (state.kind === "idle" && answers.length === 0)
      ? suggestQuestions(dataset.columns, locale, new Map(dataset.report.renamedColumns.map((c) => [c.to, c.from])))
      : []
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
        {dataset.report.sheets.length > 1 && sourceFile && (
          <Button
            variant="ghost"
            className="h-11 shrink-0 px-3 text-xs"
            disabled={busy || fileLoading}
            onClick={() => setSheetChoice({ file: sourceFile, sheets: dataset.report.sheets })}
          >
            {dataset.report.sheet} · {t.sheets.change}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          aria-label={t.dataset.close}
          onClick={() => {
            setDataset(null)
            setState({ kind: "idle" })
            setHistory([])
            setAnswers([])
            setActiveId(null)
          }}
        >
          <X aria-hidden />
        </Button>
      </div>

      <AskBar busy={busy} suggestions={suggestions} onAsk={ask} />

      {history.length > 0 && (
        <div className="-mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <MessagesSquare className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 truncate">{t.ask.followUp(history[history.length - 1]?.question ?? "")}</span>
          <Button variant="ghost" size="sm" className="h-11 shrink-0 px-3 text-xs" disabled={busy} onClick={() => setHistory([])}>
            <RotateCcw aria-hidden /> {t.ask.newTopic}
          </Button>
        </div>
      )}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      <DataPrepPanel dataset={dataset} open={prepOpen} onOpenChange={setPrepOpen} />

      {busy && <div className="h-96 animate-pulse rounded-xl border bg-card" aria-label={t.ask.computing} />}

      <div ref={resultRef} className="scroll-mt-4">
        {!busy && active && (
          // Keyed per answer so export state (e.g. "chart ready") starts fresh for every result.
          <ResultBento key={active.id} answer={active} columns={dataset.columns} rowCount={dataset.rowCount} />
        )}
      </div>

      <AnswerHistory answers={answers.filter((a) => a.id !== activeId)} onSelect={showAnswer} />
    </div>
  )
}

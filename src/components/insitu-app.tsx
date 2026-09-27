"use client"

import { useEffect, useRef, useState } from "react"
import { FileSpreadsheet, History, Layers, MessagesSquare, RotateCcw, X } from "lucide-react"
import { AnswerHistory } from "@/components/answer-history"
import { AskBar } from "@/components/ask-bar"
import { DataPrepPanel } from "@/components/data-prep-panel"
import { OverviewPanel } from "@/components/overview-panel"
import { ReportBar, type ReportItem } from "@/components/report"
import { Dropzone } from "@/components/dropzone"
import { useI18n } from "@/components/i18n-provider"
import { ResultBento, type Answer } from "@/components/result-bento"
import { SheetSelector } from "@/components/sheet-selector"
import { Button } from "@/components/ui/button"
import { isAccepted, loadFile, type Dataset } from "@/lib/engine/load-file"
import { prewarmDb } from "@/lib/engine/duckdb"
import { formatCount } from "@/lib/format"
import type { PdfProgress, SheetInfo } from "@/lib/ingest"
import { alignPlan, planForResult, resolveColumns, resolveView } from "@/lib/result-view"
import {
  MAX_HISTORY,
  MAX_SQL_CHARS,
  TranslateResponse,
  type HistoryTurn,
  type RepairContext,
  type TranslateRequest,
} from "@/lib/schema"
import { buildInsight } from "@/lib/insight"
import { loadSaved, MAX_SAVED, saveQuestions, sessionKey, type SavedQuestion } from "@/lib/session-store"
import { followUpQuestions, readableLabel, suggestQuestions } from "@/lib/suggestions"
import type { QueryPlan } from "@/lib/schema"
import { QUERY_TIMEOUT, runQuery, type QueryResult } from "@/lib/engine/run-query"

type AnswerState =
  | { kind: "idle" }
  | { kind: "asking" }
  /** `question` allows "Try again"; `detail` is the raw engine text, shown only on request. */
  | { kind: "error"; message: string; suggestions: string[]; question: string; detail?: string }

/** Longest wait for the translator (it may try three models) before the user is told. */
const ASK_TIMEOUT_MS = 45_000

/** Answers kept in the session history (newest first). */
const MAX_ANSWERS = 20

const SAMPLE_URL = "/samples/satislar.csv"

/** Read ➔ Translate ➔ Run ➔ Draw. Row data stays inside this component tree. */
export function InsituApp() {
  const { t, locale } = useI18n()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [progress, setProgress] = useState<PdfProgress | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [state, setState] = useState<AnswerState>({ kind: "idle" })
  // Every answer of this file's session stays available; one is shown in full.
  const [answers, setAnswers] = useState<Answer[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const answerCount = useRef(0)
  // Bumped when a file is opened or closed: an answer that arrives later belongs to the old file.
  const session = useRef(0)
  const pending = useRef<AbortController | null>(null)
  // Earlier questions + their SQL, so follow-ups ("and how many units?") keep the context.
  const [history, setHistory] = useState<HistoryTurn[]>([])
  // Workbook with several sheets: the user picks one before anything is loaded.
  const [sheetChoice, setSheetChoice] = useState<{ file: File; sheets: SheetInfo[] } | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [prepOpen, setPrepOpen] = useState(true)
  const [overviewOpen, setOverviewOpen] = useState(true)
  // Analyses collected for the PDF report (snapshots, so they survive the 20-answer history cap).
  const [report, setReport] = useState<ReportItem[]>([])
  // Questions saved for this file in an earlier visit, offered for restoring (never auto-run).
  const [saved, setSaved] = useState<SavedQuestion[]>([])
  const [restoring, setRestoring] = useState(false)
  const storageKey = dataset ? sessionKey(`${dataset.fileName}#${dataset.report.sheet ?? ""}`, dataset.rowCount, dataset.columns) : null

  // Remember this file's questions (text + plan only). Nothing is written until there is an
  // answer, so opening a file never erases what an earlier visit saved.
  useEffect(() => {
    if (!storageKey || answers.length === 0) return
    const current = answers.map((a) => ({ question: a.question, plan: a.plan }))
    const seen = new Set(current.map((q) => q.question))
    saveQuestions(storageKey, [...current, ...saved.filter((q) => !seen.has(q.question))].slice(0, MAX_SAVED))
  }, [storageKey, answers, saved])

  // Fetch and start the in-browser engine while the user is still choosing a file.
  useEffect(() => prewarmDb(), [])

  async function openFile(file: File, sheet?: string) {
    if (!isAccepted(file.name)) {
      setFileError(t.file.unsupported)
      return
    }
    setFileLoading(true)
    setFileError(null)
    setProgress(null)
    try {
      const loaded = await loadFile(file, sheet, setProgress)
      if (loaded.kind === "sheets") {
        setSheetChoice({ file, sheets: loaded.sheets })
        return
      }
      setSheetChoice(null)
      setSourceFile(file)
      pending.current?.abort()
      session.current++
      setDataset(loaded.dataset)
      const d = loaded.dataset
      setSaved(loadSaved(sessionKey(`${d.fileName}#${d.report.sheet ?? ""}`, d.rowCount, d.columns)))
      setState({ kind: "idle" })
      setAnswers([])
      setActiveId(null)
      setHistory([])
      // The first look leads; the prep report opens by itself only when a column needs attention.
      const d2 = loaded.dataset
      const hasOverview = d2.overview.findings.length + d2.overview.warnings.length > 0
      setOverviewOpen(true)
      setReport([])
      setPrepOpen(!hasOverview || d2.unreadable.length > 0 || d2.ambiguous.length > 0)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setFileError(t.file.readFailed(t.file.codes[detail] ?? detail))
    } finally {
      setFileLoading(false)
      setProgress(null)
    }
  }

  async function openSample() {
    setFileLoading(true)
    setFileError(null)
    try {
      const res = await fetch(SAMPLE_URL)
      if (!res.ok) throw new Error(String(res.status))
      await openFile(new File([await res.blob()], "satislar.csv", { type: "text/csv" }))
    } catch {
      setFileError(t.file.sampleFailed)
      setFileLoading(false)
    }
  }

  async function translate(payload: TranslateRequest, signal: AbortSignal): Promise<TranslateResponse | null> {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    }).catch(() => null)
    const parsed = TranslateResponse.safeParse(res ? await res.json().catch(() => null) : null)
    return parsed.success ? parsed.data : null
  }

  function toAnswer(question: string, plan: QueryPlan, result: Extract<QueryResult, { ok: true }>, contextTurns: number): Answer {
    // A result column the plan did not describe still gets a readable name ("toplam_satis" → "Toplam satış").
    const labelFor = (key: string) => readableLabel(key, locale)
    return {
      id: ++answerCount.current,
      question,
      plan,
      rows: result.rows,
      complete: result.complete,
      resultColumns: resolveColumns(alignPlan(plan, result.columns).columns, result.columns, result.rows, labelFor),
      view: resolveView(plan, result.rows, result.columns, result.complete, t.insight.other, labelFor),
      contextTurns,
      edited: false,
    }
  }

  /** The user's own SQL, run locally like every query (guard + locked engine); no translator call. */
  async function runEditedSql(base: Answer, sql: string) {
    if (!dataset) return
    const mine = session.current
    setState({ kind: "asking" })
    const result = await runQuery(sql, undefined, [t.result.yes, t.result.no])
    if (mine !== session.current) return
    if (!result.ok) {
      setState({
        kind: "error",
        message: engineMessage(result.error, t.result.sqlFailed),
        suggestions: [],
        question: base.question,
        detail: result.error,
      })
      return
    }
    const plan = planForResult(base.plan, sql, result.columns, result.rows, (k) => readableLabel(k, locale))
    const answer = { ...toAnswer(base.question, plan, result, 0), edited: true }
    setAnswers((prev) => [answer, ...prev].slice(0, MAX_ANSWERS))
    setActiveId(answer.id)
    setState({ kind: "idle" })
    if (sql.length <= MAX_SQL_CHARS) setHistory([{ question: base.question, sql }])
  }

  /** Re-runs the saved plans on this file, in the browser; the translator is not called. */
  async function restoreSaved() {
    const mine = session.current
    setRestoring(true)
    const restored: Answer[] = []
    for (const q of [...saved].reverse()) {
      const result = await runQuery(q.plan.sql, undefined, [t.result.yes, t.result.no])
      if (mine !== session.current) return
      if (result.ok) restored.unshift(toAnswer(q.question, q.plan, result, 0))
    }
    setSaved([])
    setRestoring(false)
    const seen = new Set(answers.map((a) => a.question))
    const merged = [...answers, ...restored.filter((a) => !seen.has(a.question))].slice(0, MAX_ANSWERS)
    setAnswers(merged)
    const first = merged[0]
    if (activeId === null && first) setActiveId(first.id)
    setPrepOpen(false)
  }

  function dismissSaved() {
    if (storageKey) saveQuestions(storageKey, answers.map((a) => ({ question: a.question, plan: a.plan })))
    setSaved([])
  }

  /** Plain-language text for an engine error; the technical text stays under "Technical details". */
  function engineMessage(error: string, fallback: string): string {
    if (error === QUERY_TIMEOUT) return t.ask.queryTimeout
    // A value that is not a number (strict casts, see strictNumericCasts) stops the query.
    if (/^Conversion Error/i.test(error)) return t.ask.notNumbers
    return fallback
  }

  function cancelAsk() {
    const controller = pending.current
    pending.current = null // marks the running question stale before it notices the abort
    controller?.abort()
    setState({ kind: "idle" })
  }

  /** Asks with explicit context (e.g. a drill-down on the answer on screen). */
  async function askWith(question: string, about: Answer) {
    const turns = about.plan.sql.length <= MAX_SQL_CHARS ? [{ question: about.question, sql: about.plan.sql }] : []
    setHistory(turns)
    await ask(question, turns)
  }

  async function ask(question: string, context: HistoryTurn[] = history) {
    if (!dataset) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ASK_TIMEOUT_MS)
    const mine = session.current
    // Stale: the file changed or the user cancelled / asked again while this one was running.
    const stale = () => mine !== session.current || pending.current !== controller
    setState({ kind: "asking" })
    try {
      await askOnce(question, context, controller, mine, stale, () => timedOut)
    } finally {
      clearTimeout(timer)
      if (pending.current === controller) pending.current = null
    }
  }

  async function askOnce(
    question: string,
    history: HistoryTurn[],
    controller: AbortController,
    mine: number,
    stale: () => boolean,
    timedOut: () => boolean,
  ) {
    if (!dataset) return
    const fail = (message: string, suggestions: string[] = [], detail?: string) => {
      if (mine === session.current) setState({ kind: "error", message, suggestions, question, ...(detail ? { detail } : {}) })
    }

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
      const translated = await translate(payload, controller.signal)
      if (controller.signal.aborted) {
        // Cancelled or replaced by a newer question: nothing to show. Timed out: say so.
        if (timedOut()) fail(t.ask.timeout)
        return
      }
      if (stale()) return
      if (!translated) return fail(t.ask.translateFailed)
      if (!translated.ok) return fail(translated.error, translated.suggestions)

      const plan = translated.plan
      const result = await runQuery(plan.sql, undefined, [t.result.yes, t.result.no])
      if (stale()) return
      if (!result.ok) {
        if (attempt === 0 && result.repairable && plan.sql.length <= MAX_SQL_CHARS) {
          repair = { sql: plan.sql, error: result.repairable }
          continue
        }
        // A value that is not a number (strict casts, see strictNumericCasts) stops the query.
        // Engine text is technical and English: shown only on request, never as the message.
        return fail(engineMessage(result.error, t.ask.computeFailed), [], result.error)
      }

      const answer = toAnswer(question, plan, result, history.length)
      setAnswers((prev) => [answer, ...prev].slice(0, MAX_ANSWERS))
      setActiveId(answer.id)
      setState({ kind: "idle" })
      // An unusually long query is not kept as context (the server caps SQL length).
      setHistory([...history, { question, sql: plan.sql }].filter((h) => h.sql.length <= MAX_SQL_CHARS).slice(-MAX_HISTORY))
      // The prep report and first look have done their job once the user is asking questions; keep them one click away.
      setPrepOpen(false)
      setOverviewOpen(false)
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
        <Dropzone loading={fileLoading} progress={progress} error={fileError} onFile={(file) => void openFile(file)} onSample={openSample} />
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
    setHistory(answer.plan.sql.length <= MAX_SQL_CHARS ? [{ question: answer.question, sql: answer.plan.sql }] : [])
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }))
  }
  const originals = new Map(dataset.report.renamedColumns.map((c) => [c.to, c.from]))
  const followingUp = state.kind === "idle" && answers.length > 0 && history.length > 0
  const suggestions =
    // After an error, the translator's own rephrasings come first; after an answer, follow-ups
    // on it; otherwise examples built from the file's original headers in the current language.
    state.kind === "error" && state.suggestions.length > 0
      ? state.suggestions
      : followingUp
        ? followUpQuestions(dataset.columns, locale, originals, active?.plan.sql ?? "")
        : state.kind === "error" || (state.kind === "idle" && answers.length === 0)
          ? suggestQuestions(dataset.columns, locale, originals)
          : []
  const sheetLabel = dataset.report.pdf
    ? `${t.sheets.pdfTable(dataset.report.sheet ?? "", dataset.report.pdf.tablePages)} · ${t.sheets.pdfChange}`
    : `${dataset.report.sheet} · ${t.sheets.change}`
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
          // Opens the prep report, which lists every change (works with touch and keyboard, not just hover).
          <Button
            variant="outline"
            className="hidden h-11 shrink-0 px-3 text-xs text-primary sm:inline-flex"
            title={cleanedNotes.join("\n")}
            onClick={() => setPrepOpen(true)}
          >
            {t.dataset.cleaned(cleanedNotes.length)}
          </Button>
        )}
        {dataset.report.sheets.length > 1 && sourceFile && (
          <Button
            variant="ghost"
            className="h-11 min-w-11 shrink-0 px-3 text-xs"
            disabled={busy || fileLoading}
            aria-label={sheetLabel}
            title={sheetLabel}
            onClick={() => setSheetChoice({ file: sourceFile, sheets: dataset.report.sheets })}
          >
            <Layers className="sm:hidden" aria-hidden />
            <span className="hidden sm:inline">{sheetLabel}</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          aria-label={t.dataset.close}
          onClick={() => {
            pending.current?.abort()
            session.current++
            setReport([])
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

      <AskBar busy={busy} suggestions={suggestions} suggestionsLabel={followingUp ? t.ask.followUps : t.ask.examples} onAsk={ask} />

      {/* Announces each new answer to screen readers (the region exists before its text changes). */}
      <p className="sr-only" aria-live="polite">
        {!busy && active ? `${active.plan.title}. ${buildInsight(active.view, locale, dataset.coverage)}` : ""}
      </p>

      {history.length > 0 && (
        <div className="-mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <MessagesSquare className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 truncate">{t.ask.followUp(history[history.length - 1]?.question ?? "")}</span>
          <Button variant="ghost" size="sm" className="h-11 shrink-0 px-3 text-xs" disabled={busy} onClick={() => setHistory([])}>
            <RotateCcw aria-hidden /> {t.ask.newTopic}
          </Button>
        </div>
      )}

      <ReportBar
        items={report}
        fileName={dataset.fileName}
        onRemove={(id) => setReport((prev) => prev.filter((r) => r.id !== id))}
        onClear={() => setReport([])}
      />

      {state.kind === "error" && (
        <div role="alert" className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" className="h-11 px-3" onClick={() => void ask(state.question)}>
              <RotateCcw aria-hidden /> {t.ask.retry}
            </Button>
          </div>
          {state.detail && (
            <details className="text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer content-center">{t.ask.technical}</summary>
              <code className="block rounded-md border bg-background p-2 font-mono break-all">{state.detail}</code>
            </details>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <History className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t.session.offer(saved.length)}</span>
          <Button variant="outline" size="sm" className="h-11 px-3" disabled={busy || restoring} onClick={() => void restoreSaved()}>
            {restoring ? t.session.restoring : t.session.restore}
          </Button>
          <Button variant="ghost" size="sm" className="h-11 px-3" disabled={restoring} onClick={dismissSaved}>
            {t.session.dismiss}
          </Button>
        </div>
      )}

      <OverviewPanel dataset={dataset} open={overviewOpen} onOpenChange={setOverviewOpen} busy={busy} onAsk={(q) => void ask(q)} />

      <DataPrepPanel dataset={dataset} open={prepOpen} onOpenChange={setPrepOpen} />

      {busy && (
        <div role="status" className="flex h-96 flex-col items-center justify-center gap-3 rounded-xl border bg-card">
          <span className="animate-pulse text-sm text-muted-foreground">{t.ask.computing}…</span>
          <Button variant="ghost" className="h-11 px-4 text-muted-foreground" onClick={cancelAsk}>
            <X aria-hidden /> {t.ask.cancel}
          </Button>
        </div>
      )}

      <div ref={resultRef} className="scroll-mt-4">
        {!busy && active && (
          // Keyed per answer so export state (e.g. "chart ready") starts fresh for every result.
          <ResultBento
            key={active.id}
            answer={active}
            columns={dataset.columns}
            rowCount={dataset.rowCount}
            busy={busy}
            inReport={report.some((r) => r.id === active.id)}
            coverage={dataset.coverage}
            onToggleReport={(item) =>
              setReport((prev) => (prev.some((r) => r.id === item.id) ? prev.filter((r) => r.id !== item.id) : [...prev, item]))
            }
            onRunSql={(sql) => void runEditedSql(active, sql)}
            onDrill={(label) => {
              // The drill-down is a follow-up on the answer on screen.
              if (!busy) void askWith(t.suggestions.drill(label), active)
            }}
          />
        )}
      </div>

      <AnswerHistory answers={answers.filter((a) => a.id !== activeId)} coverage={dataset.coverage} onSelect={showAnswer} />
    </div>
  )
}

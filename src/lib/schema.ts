import { z } from "zod"
import { LOCALES } from "@/lib/i18n"

/**
 * Privacy boundary. `TranslateRequest` is the only payload that ever leaves the
 * browser: column names + coarse types (and, for a repair, the generated SQL and a
 * masked engine error). It is a strict object, so any extra field (e.g. sample rows)
 * is rejected by the server.
 */
export const ColumnType = z.enum(["number", "text", "date"])
export type ColumnType = z.infer<typeof ColumnType>

/**
 * The browser sends DuckDB-safe snake_case names (see `sanitizeName`). Enforcing that shape on
 * the server keeps quotes, newlines and prose out of the prompt, so a column name can never
 * carry instructions to the model.
 */
export const COLUMN_NAME = /^[a-z0-9_]{1,64}$/

export const Column = z.strictObject({
  name: z.string().regex(COLUMN_NAME),
  type: ColumnType,
})
export type Column = z.infer<typeof Column>

/** Generated SQL is a few hundred characters; the cap only stops the endpoint being used for bulk text. */
export const MAX_SQL_CHARS = 4000

export const RepairContext = z.strictObject({
  sql: z.string().min(1).max(MAX_SQL_CHARS),
  error: z.string().min(1).max(600),
})
export type RepairContext = z.infer<typeof RepairContext>

/**
 * A previous turn of the conversation, for follow-up questions ("and how many units?").
 * Only the user's own question and the generated SQL — never any result values.
 */
export const HistoryTurn = z.strictObject({
  question: z.string().trim().min(2).max(500),
  sql: z.string().min(1).max(MAX_SQL_CHARS),
})
export type HistoryTurn = z.infer<typeof HistoryTurn>

export const MAX_HISTORY = 3

/** Another loaded file, as its own table next to `data`: its name and columns only. */
export const TableRef = z.strictObject({
  name: z.string().regex(COLUMN_NAME),
  columns: z.array(Column).min(1).max(200),
})
export type TableRef = z.infer<typeof TableRef>

export const TranslateRequest = z.strictObject({
  question: z.string().trim().min(2).max(500),
  columns: z.array(Column).min(1).max(200),
  repair: RepairContext.optional(),
  /** Earlier turns, oldest first. */
  history: z.array(HistoryTurn).max(MAX_HISTORY).optional(),
  /** Extra tables (other files), names and columns only; never rows. */
  tables: z.array(TableRef).max(3).optional(),
  /** UI language: the plan's title, labels and explanations are written in it. */
  locale: z.enum(LOCALES).optional(),
})
export type TranslateRequest = z.infer<typeof TranslateRequest>

export const ChartType = z.enum(["metric", "bar", "line", "pie", "table"])
export type ChartType = z.infer<typeof ChartType>

/** How a result column is displayed. `percent` values are already on a 0–100 scale. */
export const ValueFormat = z.enum(["currency", "number", "integer", "percent", "text", "date", "month"])
export type ValueFormat = z.infer<typeof ValueFormat>

export const OutputColumn = z.strictObject({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  format: ValueFormat,
  /** Whether summing this column over the rows is meaningful (amounts, quantities — not prices or averages). */
  total: z.boolean(),
})
export type OutputColumn = z.infer<typeof OutputColumn>

/** What the translator returns. Keys refer to the aliases in the SQL's final SELECT. */
export const QueryPlan = z.strictObject({
  sql: z.string().min(1),
  chartType: ChartType,
  xAxisKey: z.string(),
  yAxisKey: z.string(),
  seriesKey: z.string(),
  title: z.string().min(1).max(120),
  columns: z.array(OutputColumn).min(1).max(20),
  /** Assumption the translator made (e.g. "grouped by district: no province column"); "" if none. Never contains numbers from the data. */
  note: z.string().max(240),
})
export type QueryPlan = z.infer<typeof QueryPlan>

export const TranslateResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plan: QueryPlan }),
  z.object({ ok: z.literal(false), error: z.string(), suggestions: z.array(z.string()) }),
])
export type TranslateResponse = z.infer<typeof TranslateResponse>

export const ResultValue = z.union([z.number(), z.string(), z.null()])
export type ResultValue = z.infer<typeof ResultValue>

export const ResultRow = z.record(z.string(), ResultValue)
export type ResultRow = z.infer<typeof ResultRow>

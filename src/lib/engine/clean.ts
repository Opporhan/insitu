import { quoteIdent } from "@/lib/sql"

/**
 * Load-time cleaning. The file is read with every column as VARCHAR, one profiling
 * query counts which formats each column's values match, and a column is converted
 * only when EVERY non-empty value parses — so no value is silently dropped.
 *
 * Why not DuckDB's own type sniffing: it reads Turkish "1.250" as 1.25 (a 1000× error),
 * and leaves "1.250,50 TL" or "05.01.2025" as text.
 */

const NULL_TOKENS = ["", "-", "—", "n/a", "na", "null", "none", "nan", "#n/a", "#yok"]
const MONEY_NOISE = "(₺|TL|TRY|USD|EUR|\\$|€|%|\\s)"

// Time part shared by all date layouts.
const TIME = "( \\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?)?"
const ISO_RE = `\\d{4}-\\d{1,2}-\\d{1,2}([ T]\\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?)?`
const DMY_RE = `\\d{1,2}\\.\\d{1,2}\\.\\d{4}${TIME}`
const ISO_FORMATS = ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"]
const DMY_FORMATS = ["%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"]
const MDY_FORMATS = ["%m.%d.%Y %H:%M:%S", "%m.%d.%Y %H:%M", "%m.%d.%Y"]

const INT_RE = "[-+]?\\d+"
const LEADING_ZERO_RE = "[-+]?0\\d+"
const DOT_DECIMAL_RE = "[-+]?\\d*\\.\\d+"
/** "1.250": a US decimal or a Turkish thousand — cannot tell from the value alone. */
const AMBIGUOUS_RE = "[-+]?[1-9]\\d{0,2}\\.\\d{3}"
const TR_RE = "[-+]?[1-9]\\d{0,2}(\\.\\d{3})+(,\\d+)?|[-+]?\\d+,\\d+"
const US_THOUSANDS_RE = "[-+]?[1-9]\\d{0,2}(,\\d{3})+(\\.\\d+)?"

function list(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(", ")}]`
}

/** Trimmed value with common "empty" markers mapped to NULL. */
function valueExpr(col: string): string {
  const c = quoteIdent(col)
  return `CASE WHEN lower(trim(${c})) IN (${NULL_TOKENS.map((t) => `'${t}'`).join(", ")}) THEN NULL ELSE trim(${c}) END`
}

/** Value with currency symbols, percent signs and spaces removed. */
function moneyExpr(col: string): string {
  return `regexp_replace(${valueExpr(col)}, '${MONEY_NOISE}', '', 'gi')`
}

/** "05/01/2025" or "05-01-2025" → "05.01.2025". Only the date part is touched. */
function dottedExpr(col: string): string {
  return `regexp_replace(${valueExpr(col)}, '^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})', '\\1.\\2.\\3')`
}

/** "2025/01/05" or "2025.01.05" → "2025-01-05". Only the date part is touched. */
function dashedExpr(col: string): string {
  return `regexp_replace(${valueExpr(col)}, '^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})', '\\1-\\2-\\3')`
}

const PROFILE_FIELDS = [
  "n", "int", "lead0", "dot", "amb", "tr", "usk", "stripped", "isoShape", "dmyShape", "iso", "dmy", "mdy", "time", "fracDot", "fracComma",
] as const
type ProfileField = (typeof PROFILE_FIELDS)[number]
export type ColumnProfile = Record<ProfileField, number>

/** One aggregate query profiling every column. Result has fields `p{i}_{field}`. */
export function profileSql(table: string, columns: readonly string[]): string {
  // Each derived value (trimmed, money-stripped, date-normalized) is computed ONCE per
  // cell in a CTE; the aggregates below only read it. Recomputing the regexes inside every
  // aggregate made profiling several times slower on large files.
  const base = columns.map((col, i) => `${valueExpr(col)} AS v${i}`).join(", ")
  const derived = columns
    .map((_, i) => {
      const v = `v${i}`
      return [
        v,
        `regexp_replace(${v}, '${MONEY_NOISE}', '', 'gi') AS m${i}`,
        `regexp_replace(${v}, '^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})', '\\1.\\2.\\3') AS dt${i}`,
        `regexp_replace(${v}, '^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})', '\\1-\\2-\\3') AS ds${i}`,
      ].join(", ")
    })
    .join(", ")
  const parts = columns.flatMap((_, i) => {
    const [v, m, dotted, dashed] = [`v${i}`, `m${i}`, `dt${i}`, `ds${i}`]
    const match = (re: string) => `count(*) FILTER (WHERE regexp_full_match(${m}, '${re}'))`
    const p = (field: ProfileField, expr: string) => `${expr} AS p${i}_${field}`
    return [
      p("n", `count(${v})`),
      p("int", match(INT_RE)),
      p("lead0", match(LEADING_ZERO_RE)),
      p("dot", match(DOT_DECIMAL_RE)),
      p("amb", match(AMBIGUOUS_RE)),
      p("tr", match(TR_RE)),
      p("usk", match(US_THOUSANDS_RE)),
      p("stripped", `count(*) FILTER (WHERE ${m} <> ${v})`),
      // Cheap shape checks only; real date parsing runs later, and only where every value has the shape.
      p("isoShape", `count(*) FILTER (WHERE regexp_full_match(${dashed}, '${ISO_RE}'))`),
      p("dmyShape", `count(*) FILTER (WHERE regexp_full_match(${dotted}, '${DMY_RE}'))`),
      // Most digits after a trailing "." / "," — the DECIMAL scale that holds every value exactly.
      p("fracDot", `coalesce(max(length(regexp_extract(${m}, '\\.(\\d+)$', 1))), 0)`),
      p("fracComma", `coalesce(max(length(regexp_extract(${m}, ',(\\d+)$', 1))), 0)`),
      // Midnight-only times (typical of Excel date cells) still count as plain dates.
      p("time", `count(*) FILTER (WHERE ${v} LIKE '%:%' AND NOT regexp_matches(${v}, ' 0?0:00(:00(\\.0+)?)?$'))`),
    ]
  })
  return `WITH b AS (SELECT ${base} FROM ${table}), d AS (SELECT ${derived} FROM b)\nSELECT ${parts.join(",\n  ")} FROM d`
}

type DateCheck = { index: number; kind: "iso" | "dmy" | "mdy" }

/** Counts values that really parse as dates, for the given columns only. */
export function dateCheckSql(table: string, columns: readonly string[], checks: readonly DateCheck[]): string {
  const parts = checks.map(({ index, kind }) => {
    const col = columns[index] ?? ""
    const expr = kind === "iso" ? dashedExpr(col) : dottedExpr(col)
    const formats = kind === "iso" ? ISO_FORMATS : kind === "dmy" ? DMY_FORMATS : MDY_FORMATS
    return `count(*) FILTER (WHERE try_strptime(${expr}, ${list(formats)}) IS NOT NULL) AS p${index}_${kind}`
  })
  return `SELECT ${parts.join(", ")} FROM ${table}`
}

/**
 * Profiles every column with as few expensive passes as possible: one cheap pass for all
 * counts, then date parsing only for columns whose every value already has a date shape
 * (month-first only when day-first failed). Parsing dates was ~80% of profiling time.
 */
export async function profileColumns(
  query: (sql: string) => Promise<Record<string, unknown>>,
  table: string,
  columns: readonly string[],
): Promise<ColumnProfile[]> {
  const first = await query(profileSql(table, columns))
  const profiles = columns.map((_, i) => readProfile(first, i))

  const apply = async (checks: DateCheck[]) => {
    if (checks.length === 0) return
    const row = await query(dateCheckSql(table, columns, checks))
    for (const { index, kind } of checks) {
      const p = profiles[index]
      if (p) p[kind] = Number(row[`p${index}_${kind}`] ?? 0)
    }
  }
  const all = (field: "isoShape" | "dmyShape") => profiles.flatMap((p, index) => (p.n > 0 && p[field] === p.n ? [index] : []))
  await apply([...all("isoShape").map((index) => ({ index, kind: "iso" as const })), ...all("dmyShape").map((index) => ({ index, kind: "dmy" as const }))])
  await apply(all("dmyShape").filter((i) => (profiles[i]?.dmy ?? 0) < (profiles[i]?.n ?? 0)).map((index) => ({ index, kind: "mdy" as const })))
  return profiles
}

export function readProfile(row: Record<string, unknown>, index: number): ColumnProfile {
  const profile = {} as ColumnProfile
  for (const field of PROFILE_FIELDS) profile[field] = Number(row[`p${index}_${field}`] ?? 0)
  return profile
}

export type CleanKind =
  | "text"
  | "integer"
  | "decimal"
  | "tr-number"
  | "us-thousands"
  | "iso-date"
  | "dmy-date"
  | "mdy-date"

/**
 * `converted` is true when the cleaner changed the representation (worth telling the user).
 * `unreadable` > 0: the column is mostly numbers, but that many values are not, so it stays text.
 */
export type ColumnDecision = {
  name: string
  kind: CleanKind
  expr: string
  converted: boolean
  currencyStripped: boolean
  unreadable: number
}

const CONVERTED: ReadonlySet<CleanKind> = new Set(["tr-number", "us-thousands", "dmy-date", "mdy-date"])

/** Beyond this many decimals the values are float noise (e.g. Excel's 0.30000000000000004). */
const MAX_EXACT_SCALE = 10

/**
 * Exact DECIMAL when the scale allows — sums of money must not drift the way DOUBLE
 * sums do (100k × "1.250,50" summed as DOUBLE ends in …,1599913 instead of …,16).
 */
function numericType(scale: number): string {
  if (scale === 0) return "BIGINT"
  return scale <= MAX_EXACT_SCALE ? `DECIMAL(38, ${scale})` : "DOUBLE"
}

export function decideColumn(name: string, p: ColumnProfile): ColumnDecision {
  const v = valueExpr(name)
  const m = moneyExpr(name)
  const dateType = p.time > 0 ? "TIMESTAMP" : "DATE"
  const make = (kind: CleanKind, expr: string, stripped = false, unreadable = 0): ColumnDecision => ({
    name,
    kind,
    expr,
    converted: CONVERTED.has(kind) || stripped,
    currencyStripped: stripped,
    unreadable,
  })
  const stripped = p.stripped > 0

  if (p.n === 0) return make("text", v)
  if (p.iso === p.n) return make("iso-date", `CAST(try_strptime(${dashedExpr(name)}, ${list(ISO_FORMATS)}) AS ${dateType})`)
  // Turkish users write day first; month-first only when day-first cannot parse every value.
  if (p.dmy === p.n) return make("dmy-date", `CAST(try_strptime(${dottedExpr(name)}, ${list(DMY_FORMATS)}) AS ${dateType})`)
  if (p.mdy === p.n) return make("mdy-date", `CAST(try_strptime(${dottedExpr(name)}, ${list(MDY_FORMATS)}) AS ${dateType})`)
  // Codes like "00123" lose meaning as numbers.
  if (p.lead0 > 0) return make("text", v)
  if (p.int === p.n) return make("integer", `TRY_CAST(${m} AS BIGINT)`, stripped)
  // Dot decimals, unless every dotted value is also a valid Turkish thousand ("1.250").
  if (p.int + p.dot === p.n && p.dot > p.amb) {
    return make("decimal", `TRY_CAST(${m} AS ${numericType(p.fracDot)})`, stripped)
  }
  // Turkish format; the ambiguous "1.250" matches TR_RE and is read as a thousand.
  if (p.int + p.tr === p.n) {
    return make("tr-number", `TRY_CAST(replace(replace(${m}, '.', ''), ',', '.') AS ${numericType(p.fracComma)})`, stripped)
  }
  if (p.int + p.usk + p.dot === p.n && p.usk > 0) {
    return make("us-thousands", `TRY_CAST(replace(${m}, ',', '') AS ${numericType(p.fracDot)})`, stripped)
  }
  // Mostly numbers, but a few values are not (a typo, a misread scan): the column stays text and
  // the user is told how many values block it. Values are never guessed.
  const numeric = Math.max(p.int + p.dot, p.int + p.tr, p.int + p.usk + p.dot)
  return make("text", v, false, p.n >= 5 && numeric >= 0.8 * p.n ? p.n - numeric : 0)
}

export function buildCleanTableSql(target: string, source: string, decisions: readonly ColumnDecision[]): string {
  const select = decisions.map((d) => `${d.expr} AS ${quoteIdent(d.name)}`).join(",\n  ")
  return `CREATE TABLE ${target} AS SELECT\n  ${select}\nFROM ${source}`
}

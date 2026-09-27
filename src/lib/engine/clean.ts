import { quoteIdent } from "@/lib/sql"

/**
 * Load-time cleaning. The file is read with every column as VARCHAR, one profiling
 * query counts which formats each column's values match, and a column is converted
 * only when EVERY non-empty value parses — so no value is silently dropped.
 *
 * Why not DuckDB's own type sniffing: it reads Turkish "1.250" as 1.25 (a 1000× error),
 * and leaves "1.250,50 TL" or "05.01.2025" as text.
 */

const NULL_TOKENS = [
  "", "-", "—", "n/a", "na", "null", "none", "nan", "#n/a", "#yok",
  // Excel error values exported as text (English and Turkish Excel).
  "#div/0!", "#sayı/0!", "#sayi/0!", "#value!", "#değer!", "#ref!", "#başv!", "#name?", "#ad?", "#num!", "#sayı!", "#sayi!", "#null!", "#boş!",
]
const MONEY_NOISE = "(₺|TL|TRY|USD|EUR|\\$|€|%|\\s)"

// Time part shared by all date layouts (optionally with fractions of a second and AM/PM).
const TIME = "( \\d{1,2}:\\d{2}(:\\d{2}(\\.\\d+)?)?( ?[AaPp][Mm])?)?"
/** Full dates, or year-month only ("2025-01" = that month). */
const ISO_RE = `\\d{4}-\\d{1,2}(-\\d{1,2}${TIME})?`
/** Four-digit years, or zero-padded two-digit ones ("05.01.25"; "1.2.3" stays a version number). */
const DMY_RE = `(\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{2}\\.\\d{2}\\.\\d{2})${TIME}`
const withTimes = (date: string) => [
  `${date} %H:%M:%S.%f`,
  `${date} %H:%M:%S`,
  `${date} %H:%M`,
  `${date} %I:%M:%S %p`,
  `${date} %I:%M %p`,
  `${date} %I:%M:%S%p`,
  `${date} %I:%M%p`,
  date,
]
const ISO_FORMATS = [...withTimes("%Y-%m-%d"), "%Y-%m"]
const DMY_FORMATS = withTimes("%d.%m.%Y")
const MDY_FORMATS = withTimes("%m.%d.%Y")

/** Month names in Turkish and English (full and short, with or without Turkish letters). */
const MONTHS = [
  "ocak|oca|january|jan",
  "[şs]ubat|[şs]ub|february|feb",
  "mart|mar|march",
  "nisan|nis|april|apr",
  "may[ıi]s|may",
  "haziran|haz|june|jun",
  "temmuz|tem|july|jul",
  "a[ğg]ustos|a[ğg]u|august|aug",
  "eyl[üu]l|eyl|september|sept|sep",
  "ek[iı]m|eki|october|oct",
  "kas[ıi]m|kas|november|nov",
  "aral[ıi]k|ara|december|dec",
] as const

/**
 * "5 Ocak 2025", "05 Oca. 2025 14:30", "January 5, 2025" → "5.01.2025…", so named months go
 * through the same day-first parser. Only values that start like a named date take this path.
 */
function monthNamesOf(x: string): string {
  // "İ" lower-cases to "i" + a combining dot in Unicode; fold it first so "EKİM" matches.
  let out = `lower(replace(${x}, 'İ', 'i'))`
  MONTHS.forEach((names, i) => {
    const mm = String(i + 1).padStart(2, "0")
    out = `regexp_replace(${out}, '^(\\d{1,2})\\.?\\s+(${names})\\.?,?\\s+(\\d{4})(.*)$', '\\1.${mm}.\\3\\4')`
    out = `regexp_replace(${out}, '^(${names})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(.*)$', '\\2.${mm}.\\3\\4')`
  })
  return `CASE WHEN regexp_matches(${x}, '^[0-9]{1,2}\\.?\\s+\\pL|^\\pL+\\.?\\s+[0-9]') THEN ${out} ELSE ${x} END`
}

/** Up to 18 digits: longer "numbers" (card numbers, long IDs) do not fit BIGINT and stay text. */
const INT_RE = "[-+]?\\d{1,18}"
const LEADING_ZERO_RE = "[-+]?0\\d+"
const DOT_DECIMAL_RE = "[-+]?\\d*\\.\\d+"
/** "1.250": a US decimal or a Turkish thousand — cannot tell from the value alone. */
const AMBIGUOUS_RE = "[-+]?[1-9]\\d{0,2}\\.\\d{3}"
const TR_RE = "[-+]?[1-9]\\d{0,2}(\\.\\d{3})+(,\\d+)?|[-+]?\\d+,\\d+"
const US_THOUSANDS_RE = "[-+]?[1-9]\\d{0,2}(,\\d{3})+(\\.\\d+)?"
/** "1,250": a Turkish decimal or a US thousand — cannot tell from the value alone. */
const AMBIGUOUS_COMMA_RE = "[-+]?[1-9]\\d{0,2}(,\\d{3})+"
const COMMA_DECIMAL_RE = "[-+]?\\d+,\\d+"

function list(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(", ")}]`
}

/** Trimmed value with common "empty" markers mapped to NULL. */
function valueExpr(col: string): string {
  const c = quoteIdent(col)
  return `CASE WHEN lower(trim(${c})) IN (${NULL_TOKENS.map((t) => `'${t}'`).join(", ")}) THEN NULL ELSE trim(${c}) END`
}

/**
 * Accounting notation to a plain sign: "(1.250,00)" and "1.250,00-" → "-1.250,00", and the
 * Unicode minus "−" → "-". Only a whole value made of digits and separators is touched.
 */
function signExpr(x: string): string {
  return `regexp_replace(regexp_replace(replace(${x}, '−', '-'), '^\\(([0-9.,]+)\\)$', '-\\1'), '^([0-9.,]+)-$', '-\\1')`
}

/** Value with currency symbols, percent signs and spaces removed, accounting signs normalized. */
function moneyExpr(col: string): string {
  return signExpr(`regexp_replace(${valueExpr(col)}, '${MONEY_NOISE}', '', 'gi')`)
}

/** "05/01/2025", "05-01-25" or "5 Ocak 2025" → "05.01.2025". Only the date part is touched. */
function dottedOf(x: string): string {
  const dotted = `regexp_replace(${monthNamesOf(x)}, '^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})', '\\1.\\2.\\3')`
  // Two-digit years like spreadsheets write them: 00–69 → 2000s, 70–99 → 1900s.
  const century = `regexp_replace(regexp_replace(${dotted}, '^(\\d{2}\\.\\d{2}\\.)([0-6]\\d)($|\\s)', '\\120\\2\\3'), '^(\\d{2}\\.\\d{2}\\.)([7-9]\\d)($|\\s)', '\\119\\2\\3')`
  return `upper(${century})`
}

/**
 * "2025/01/05" or "2025.01.05" → "2025-01-05"; ISO "T" becomes a space and a trailing zone
 * ("Z", "+03:00") is dropped: times are kept as written, never shifted between time zones.
 */
function dashedOf(x: string): string {
  // Year-month only with "-" or "/": "2024.5" is a decimal number, not May 2024.
  const dashed = `regexp_replace(regexp_replace(${x}, '^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})', '\\1-\\2-\\3'), '^(\\d{4})/(\\d{1,2})$', '\\1-\\2')`
  return `regexp_replace(regexp_replace(${dashed}, '^(\\d{4}-\\d{1,2}-\\d{1,2})T', '\\1 '), '(:\\d{2}(\\.\\d+)?)(Z|[+-]\\d{2}:?\\d{2})$', '\\1')`
}

const dottedExpr = (col: string) => dottedOf(valueExpr(col))
const dashedExpr = (col: string) => dashedOf(valueExpr(col))

const PROFILE_FIELDS = [
  "n", "int", "lead0", "dot", "amb", "tr", "usk", "ambComma", "commaDec", "stripped", "isoShape", "dmyShape", "iso", "dmy", "mdy", "time", "fracDot", "fracComma",
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
        `${signExpr(`regexp_replace(${v}, '${MONEY_NOISE}', '', 'gi')`)} AS m${i}`,
        `regexp_replace(${v}, '${MONEY_NOISE}', '', 'gi') AS s${i}`,
        `${dottedOf(v)} AS dt${i}`,
        `${dashedOf(v)} AS ds${i}`,
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
      p("ambComma", match(AMBIGUOUS_COMMA_RE)),
      p("commaDec", match(COMMA_DECIMAL_RE)),
      // Currency/percent/space removal only; accounting signs are not "stripped" noise.
      p("stripped", `count(*) FILTER (WHERE s${i} <> ${v})`),
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
  /** Numbers like "1,250" that are either 1.25 or 1250: kept as text rather than guessed. */
  ambiguous: boolean
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
  const make = (kind: CleanKind, expr: string, stripped = false, unreadable = 0, ambiguous = false): ColumnDecision => ({
    name,
    kind,
    expr,
    converted: CONVERTED.has(kind) || stripped,
    currencyStripped: stripped,
    unreadable,
    ambiguous,
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
  // Every comma value looks like "1,250" / "12,500": Turkish decimal or US thousand? A wrong
  // guess is a 1000× error, so the column stays text and the user is told why.
  if (p.int + p.tr === p.n && p.commaDec > 0 && p.ambComma === p.commaDec) return make("text", v, false, 0, true)
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

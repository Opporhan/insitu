# insitu.

[![CI](https://github.com/Opporhan/insitu/actions/workflows/ci.yml/badge.svg)](https://github.com/Opporhan/insitu/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Türkçe](README.tr.md) · **English**

**Talk to your table.** Drop a CSV, Excel or PDF file, ask the way you'd ask a colleague, and get a presentation-ready chart plus a one-sentence insight in seconds. Your data never leaves your device.

![Insitu demo](docs/demo.gif)

> *In situ* — Latin for "in its original place". Every computation runs in the user's own browser.

**Live demo:** [insitu-five.vercel.app](https://insitu-five.vercel.app)

## How it works

```mermaid
flowchart LR
  subgraph Browser["Browser (data stays here)"]
    F[CSV / Excel] -->|Worker: encoding, Excel→CSV| C[Cleaning<br/>1.250,50 TL · 05.01.2025]
    C --> D[(DuckDB-WASM<br/>Worker)]
    D --> V[View + insight<br/>₺ · % · localized dates]
    V --> G[Chart / table<br/>PNG · CSV · clipboard]
  end
  Q[Question] --> A
  C -. column names only .-> A[/api/translate/]
  A -->|question + column names| M[Gemini]
  M -->|SQL + chart plan| A
  A -. QueryPlan .-> D
```

1. **Read:** The file is prepared in a Web Worker (Excel → CSV, Windows-1254 → UTF-8) and loaded into DuckDB-WASM. It is never sent to a server.
2. **Clean:** Every column is first read as text; a single profiling query decides its format. Values like `1.250,50 TL`, `₺ 999,99`, `05.01.2025` or `5/1/2025` become proper types. A column is converted only if **every** value fits the format. Money is stored as `DECIMAL` so sums never drift by a cent.
3. **Translate:** Only the question and the column names/types go to the AI (`{ question, columns }`). The schema is strict (`z.strictObject`) — there is no field for row data. Gemini returns a SQL query and a chart plan.
4. **Run:** The SQL passes a guard (single `SELECT`, no file or network functions) and runs in DuckDB in the browser. After loading, DuckDB's external access is disabled and locked.
5. **Draw:** If the result is consistent with the plan it becomes a metric, bar, line or pie chart; otherwise it falls back to a table instead of a misleading chart. The insight sentence is never written by the AI: the model can't see the result, so the sentence is computed from the real result in the browser.

## Messy files (Universal Ingestion)

Corporate Excel and CSV files are rarely clean. On upload Insitu automatically does the following and lists every change in a **preparation report**:
- A **sheet selector** when several sheets contain data
- **Header detection** (first 15 rows), skipping report titles / notes / blank rows above it
- **Delimiter sniffing** for `,` `;` tab `|`; UTF-8, UTF-16 and **Windows-1254** (Turkish Excel) encodings
- Removal of empty and ghost rows/columns and **TOTAL / GRAND TOTAL / AVERAGE** summary rows (no double counting)
- Queryable column names (`Tutar (TL) 💰` → `tutar_tl`, duplicates `tutar_tl_1`)
- A **20-row preview** of the cleaned data

## PDF files (text and scanned)

PDFs are read **entirely in the browser**; the file is never uploaded and the AI still only sees column names.
- **Text PDFs** (reports, statements, invoices exported from software) are read with pdf.js. Tables are rebuilt from text positions: cell borders when the table is ruled, whitespace between columns otherwise; right-aligned numbers stay in their column.
- Messy layouts are handled: report titles and notes above the table, **page headers/footers** ("Page 3 / 10"), the **header repeated on every page**, a table **split over several pages**, **cell text wrapped onto a second line**, two-line headers, sparse debit/credit columns and several tables in one document (you pick one, like Excel sheets).
- **Scanned PDFs** are read with in-browser OCR (tesseract.js). Two models run in parallel: digits come from the Turkish+English model, Turkish letters from the Turkish model only when both agree on the word. The engine and models are downloaded once from a CDN; the page image never leaves the device. Every scanned number and date is **cross-checked**: accepted when two engines agree, otherwise read again by two digits-only engines and decided by a majority of agreeing readings. When no two readings agree, the value is marked “(?)” and its column is never summed.
- **No silent wrong numbers:** a column is converted to numbers only if every value parses. If a few values can't be read (a misread scan), the column stays text, the report names it, and a calculation that needs it is stopped instead of skipping values.

When a requested concept isn't in the table, the closest column is used and a note says so (e.g. "grouped by district: no province column").

## Follow-up questions

After "show the top 3 products this month", questions like "and how many units?", "what about last month?" or "only card payments" keep the earlier scope (period, filters, selected items). For this, only the **text and SQL** of the last 3 questions are sent to the AI — never their results. "New topic" clears the context.

## Accuracy principles

- **No invented numbers.** The model never sees the data; every number comes from DuckDB, every insight from the actual result.
- **Exact totals.** Money columns are `DECIMAL`; client-side sums use Neumaier summation. Verified to the cent on a 100,000-row test.
- **No misleading charts.** Repeated categories, negative pie slices or more than 7 slices (merged into "Other") are checked. No chart or total is derived from a truncated (partial) result.
- **Meaningful insights.** No percentages from a zero base, no growth rates on cumulative series, and an incomplete last period is called out.

## Built not to freeze

| Work | Where it runs |
|---|---|
| File reading, Excel parsing, re-encoding | `prepare.worker.ts` (Web Worker) |
| All SQL, the cleaning profile | DuckDB-WASM (Web Worker) |
| Results on screen | At most 10,000 rows fetched, 500 shown in tables, line charts ≤ 2,000 points |

Loading and querying a 100,000-row, Windows-1254-encoded, `;`-separated Turkish CSV produced **zero** main-thread tasks over 50 ms (Long Tasks API).

## Languages

The **TR | EN** switch in the top-right changes the UI, insight sentences, number and date formats (₺1.234,56 ↔ ₺1,234.56, "25 Eyl 2026" ↔ "Sep 25, 2026") and the titles/labels the AI generates. The choice is stored in a cookie; on the first visit the browser language decides. All text lives in `src/lib/i18n.ts`, and the English dictionary must match the Turkish type — a missing translation is a compile error. Amounts are shown in Turkish lira in both languages.

## Tech

Turkish / English UI · Dark (default) and light theme · Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · Recharts · DuckDB-WASM · SheetJS · Zod · Gemini API · Vitest

## Run locally

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY; without it, a rule-based fallback translator is used
npm run dev                                    # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests (formatting, cleaning against real DuckDB, views, insights, guard, schema, i18n) |
| `npm run eval` | Runs the 63 questions in `scripts/questions.txt` end to end with real Gemini + DuckDB |
| `npm run typecheck` · `npm run lint` · `npm run build` | Type check, lint, production build |

## Deploy to Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new) (no extra configuration needed).
2. Add `GEMINI_API_KEY` under **Settings → Environment Variables**.
3. Deploy. The Hobby plan is free for personal projects.

> **Quota protection:** `/api/translate` is limited to 10 requests per IP per minute (`src/lib/rate-limit.ts`). The limit is kept in memory, so on Vercel each server instance counts separately — set a quota on the key in Google AI Studio for a hard cap.

## Project structure

```
src/
  app/api/translate/route.ts   The only server endpoint (question + column names → plan)
  lib/translator/              Gemini system prompt and schema; keyless fallback
  lib/engine/                  DuckDB, cleaning, worker, SQL guard, normalize
  lib/result-view.ts           Plan + rows → drawable view
  lib/insight.ts, format.ts    Insight sentence; ₺ / % / date formats
  lib/i18n.ts                  All UI text (tr, en)
  components/                  Bento result screen, chart, metric, table
scripts/eval.mts               End-to-end question-set evaluation
```

See [`CLAUDE.md`](CLAUDE.md) for architecture rules and development principles (in Turkish) and [`docs/design-system.md`](docs/design-system.md) for the design system.

### Claude Code skills

The project was built with skills in `.claude/skills/`. `ui-ux-pro-max` and `nextjs-app-router-patterns` (MIT) are included. `mastering-typescript` is published without a license, so it is not included; to install it:

```bash
git clone --depth 1 https://github.com/SpillwaveSolutions/mastering-typescript-skill /tmp/mts
cp -R /tmp/mts/mastering-typescript .claude/skills/
```

## Contributing

Issues and pull requests are welcome.

1. Fork the repo and create a branch.
2. `cp .env.example .env.local` and add a Gemini key (free at [Google AI Studio](https://aistudio.google.com/apikey)).
3. Make your change; keep `npm run typecheck`, `npm run lint` and `npm test` green (CI runs them on every pull request). If you change the prompt, run `npm run eval` too.
4. Follow the privacy boundary and rules in [`CLAUDE.md`](CLAUDE.md): row data must never leave the browser.

## License

[MIT](LICENSE) © 2026 Orhan Özkan — free to use, modify and distribute, including commercially, as long as the copyright notice is kept. Third-party skills under `.claude/skills/` keep their own licenses.

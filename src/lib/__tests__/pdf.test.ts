import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { beforeAll, describe, expect, it } from "vitest"
import { buildCleanTableSql, decideColumn, profileColumns } from "@/lib/engine/clean"
import { ingest, type IngestReport } from "@/lib/ingest"
import { extractTables, type CellBox, type Glyph, type PageData, type PdfTable } from "@/lib/ingest/pdf/layout"
import { verifyOcrTable } from "@/lib/ingest/pdf/verify"
import { drawTable, newDoc, text, trMoney, type TableSpec } from "./pdf-fixtures"

let conn: DuckDBConnection
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(":memory:")).connect()
})

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

/** The app's pipeline: ingest → text table → cleaned, typed table `data`. */
async function load(bytes: Uint8Array, sheet?: string): Promise<{ report: IngestReport; columns: string[] }> {
  const res = await ingest("rapor.pdf", buf(bytes), sheet)
  if (res.kind !== "table") throw new Error(`expected a table, got ${res.sheets.length} choices`)
  const names = (res.csv.split("\r\n")[0] ?? "").split(",")
  // Parse the RFC 4180 CSV through DuckDB itself, like the browser does.
  const path = join(tmpdir(), `insitu-pdf-${process.pid}.csv`)
  writeFileSync(path, res.csv)
  await conn.run(`CREATE OR REPLACE TABLE raw AS SELECT * FROM read_csv('${path}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"', null_padding = true)`)
  const read = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS()[0] ?? {}
  const profiles = await profileColumns(read, "raw", names)
  await conn.run("DROP TABLE IF EXISTS data")
  await conn.run(buildCleanTableSql("data", "raw", profiles.map((p, i) => decideColumn(names[i] ?? "", p))))
  return { report: res.report, columns: names }
}

const scalar = async (sql: string) => {
  const v = (await conn.runAndReadAll(sql)).getRowObjectsJS()[0]?.["v"]
  return typeof v === "bigint" ? Number(v) : v
}
const cents = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100)

function salesRows(n: number, wrapEvery = 7): { rows: string[][]; totalCents: number } {
  const rows: string[][] = []
  let totalCents = 0
  for (let i = 0; i < n; i++) {
    const adet = (i % 9) + 1
    const fiyat = trMoney(12.5 + i * 3.35 + (i % 3) * 1000)
    const tutar = trMoney((adet * Math.round((12.5 + i * 3.35 + (i % 3) * 1000) * 100)) / 100)
    totalCents += cents(tutar)
    rows.push([
      `${String((i % 28) + 1).padStart(2, "0")}.0${(i % 9) + 1}.2025`,
      ["Kadıköy", "Beşiktaş", "Çankaya", "Bornova", "Şişli"][i % 5] ?? "",
      i % wrapEvery === 3 ? "Organik Çiçek Balı\nKavanoz 850 gr" : `Ürün ${i}`,
      String(adet),
      fiyat,
      tutar,
    ])
  }
  return { rows, totalCents }
}

const SALES_COLUMNS: TableSpec["columns"] = [
  { title: "Tarih", width: 70 },
  { title: "İlçe", width: 80 },
  { title: "Ürün Adı", width: 150 },
  { title: "Adet", width: 45, align: "right" },
  { title: "Birim Fiyat", width: 75, align: "right" },
  { title: "Tutar (TL)", width: 85, align: "right" },
]

describe("PDF ingestion", () => {
  it("reads a messy multi-page report: banner, prose, page footers, repeated headers, wrapped cells, grand total", async () => {
    const d = await newDoc()
    const { rows, totalCents } = salesRows(95)
    let first = true
    const end = drawTable(d, { columns: SALES_COLUMNS, rows }, {
      top: 130,
      decorate: (page, n) => {
        text(page, d.font, "ACME Gıda A.Ş. — 2025 Satış Raporu", 40, 30, 14)
        text(page, d.font, `Sayfa ${n} / 3`, 270, 815, 8)
        text(page, d.font, "Gizli — yalnızca iç kullanım", 400, 815, 8)
        if (first) {
          text(page, d.font, "Rapor tarihi: 05.10.2025", 40, 80)
          text(page, d.font, "Hazırlayan: Muhasebe", 300, 80)
          text(page, d.font, "Bu rapor tüm şubelerin 2025 yılı satışlarını içerir ve izinsiz paylaşılamaz; rakamlar KDV dahildir.", 40, 100)
        }
        first = false
      },
    })
    text(end.page, d.font, "GENEL TOPLAM", 44, end.top + 12)
    text(end.page, d.font, trMoney(totalCents / 100), 420, end.top + 12)

    const { report, columns } = await load(await d.doc.save())
    expect(columns).toEqual(["tarih", "ilce", "urun_adi", "adet", "birim_fiyat", "tutar_tl"])
    expect(report.rowCount).toBe(95)
    expect(report.droppedTotalRows).toEqual(["GENEL TOPLAM"])
    expect(report.droppedRepeatedHeaders).toBeGreaterThanOrEqual(1)
    expect(report.pdf?.mergedWrappedRows).toBe(14)
    expect(report.pdf?.droppedPageFurniture).toBeGreaterThanOrEqual(6)
    expect(await scalar("SELECT (sum(tutar_tl) * 100)::BIGINT AS v FROM data")).toBe(totalCents)
    expect(await scalar("SELECT count(*) AS v FROM data WHERE urun_adi = 'Organik Çiçek Balı Kavanoz 850 gr'")).toBe(14)
    expect(await scalar("SELECT typeof(tarih) AS v FROM data LIMIT 1")).toBe("DATE")
  })

  it("reads a bordered (lattice) table whose cells are vertically centred over two lines", async () => {
    const d = await newDoc()
    const { rows, totalCents } = salesRows(30, 4)
    drawTable(d, { columns: SALES_COLUMNS, rows, ruled: true, rowHeight: 18 })
    const { report } = await load(await d.doc.save())
    expect(report.rowCount).toBe(30)
    expect(await scalar("SELECT (sum(tutar_tl) * 100)::BIGINT AS v FROM data")).toBe(totalCents)
  })

  it("offers every table of a document as a choice and reads each exactly", async () => {
    const d = await newDoc()
    const a = salesRows(12)
    const page = d.doc.addPage([595, 842])
    text(page, d.font, "1. Satışlar", 40, 50, 12)
    const end = drawTable(d, { columns: SALES_COLUMNS, rows: a.rows }, { page, top: 70 })
    text(page, d.font, "2. Bölge hedefleri", 40, end.top + 40, 12)
    const targets = [["Marmara", "1.200.000,00", "%12"], ["Ege", "850.000,50", "%9"], ["İç Anadolu", "640.250,25", "%7"]]
    drawTable(d, { columns: [{ title: "Bölge", width: 120 }, { title: "Hedef (TL)", width: 110, align: "right" }, { title: "Büyüme", width: 70, align: "right" }], rows: targets }, { page, top: end.top + 60 })

    const res = await ingest("r.pdf", buf(await d.doc.save()))
    expect(res.kind).toBe("sheets")
    if (res.kind !== "sheets") return
    expect(res.sheets.map((s) => [s.rows, s.columns, s.pages])).toEqual([[12, 6, [1, 1]], [3, 3, [1, 1]]])

    const bytes = await d.doc.save()
    await load(bytes, "1")
    expect(await scalar("SELECT (sum(tutar_tl) * 100)::BIGINT AS v FROM data")).toBe(a.totalCents)
    const second = await load(bytes, "2")
    expect(second.columns).toEqual(["bolge", "hedef_tl", "buyume"])
    expect(await scalar("SELECT (sum(hedef_tl) * 100)::BIGINT AS v FROM data")).toBe(269025075)
  })

  it("keeps sparse columns (debit/credit) and joins wrapped descriptions, like a bank statement", async () => {
    const d = await newDoc()
    const rows: string[][] = []
    let debit = 0
    let credit = 0
    for (let i = 0; i < 40; i++) {
      const amount = trMoney(100 + i * 17.25)
      const isDebit = i % 3 !== 0
      if (isDebit) debit += cents(amount)
      else credit += cents(amount)
      rows.push([
        `${String((i % 28) + 1).padStart(2, "0")}.03.2025`,
        i % 5 === 0 ? "EFT GELEN — ACME GIDA A.Ş.\nFatura no 2025/00" + i : `POS HARCAMA MAĞAZA ${i}`,
        isDebit ? amount : "",
        isDebit ? "" : amount,
        trMoney(50000 - i * 10),
      ])
    }
    drawTable(d, {
      columns: [
        { title: "İşlem Tarihi", width: 70 },
        { title: "Açıklama", width: 190 },
        { title: "Borç", width: 80, align: "right" },
        { title: "Alacak", width: 80, align: "right" },
        { title: "Bakiye", width: 90, align: "right" },
      ],
      rows,
    })
    const { report } = await load(await d.doc.save())
    expect(report.rowCount).toBe(40)
    expect(await scalar("SELECT (sum(borc) * 100)::BIGINT AS v FROM data")).toBe(debit)
    expect(await scalar("SELECT (sum(alacak) * 100)::BIGINT AS v FROM data")).toBe(credit)
    expect(await scalar("SELECT count(*) AS v FROM data WHERE aciklama LIKE 'EFT GELEN%Fatura no%'")).toBe(8)
  })

  it("reads the 2,574-row sample exported to a 60+ page landscape PDF with the exact revenue", async () => {
    const [header, ...lines] = readFileSync("public/samples/satislar.csv", "utf8").trim().split(/\r?\n/)
    const d = await newDoc()
    const widths = [55, 62, 55, 70, 72, 130, 32, 60, 62, 85, 80]
    const right = new Set([6, 7, 8])
    const columns = (header ?? "").split(",").map((title, i) => ({ title, width: widths[i] ?? 60, align: right.has(i) ? ("right" as const) : ("left" as const) }))
    const rows = lines.map((l) => l.split(","))
    const landscape: [number, number] = [842, 595]
    const first = d.doc.addPage(landscape)
    // Continuation pages are A4 portrait in the helper; draw page by page in landscape instead.
    let start = 0
    let page = first
    while (start < rows.length) {
      const chunk = rows.slice(start, start + 28)
      drawTable(d, { columns, rows: chunk, size: 8, rowHeight: 16 }, { page, top: 40, x: 20 })
      text(page, d.font, `Sayfa ${d.doc.getPageCount()}`, 400, 580, 8)
      start += 28
      if (start < rows.length) page = d.doc.addPage(landscape)
    }
    const { report } = await load(await d.doc.save())
    expect(report.rowCount).toBe(2574)
    expect(report.pdf?.pages).toBe(92)
    expect(await scalar("SELECT sum(tutar)::BIGINT AS v FROM data")).toBe(6144813)
  }, 60_000)

  it("reports clear errors for PDFs without tables, and broken files", async () => {
    const prose = await PDFDocument.create()
    const font = await prose.embedFont(StandardFonts.Helvetica)
    prose.addPage().drawText("Just a letter.\nNo table here, only text.", { x: 50, y: 700, size: 12, font })
    await expect(ingest("a.pdf", buf(await prose.save()))).rejects.toThrow("pdf-no-table")
    await expect(ingest("b.pdf", buf(new TextEncoder().encode("%PDF-1.7 broken")))).rejects.toThrow("pdf-invalid")
    // A page with no text layer (scanned) cannot be read without OCR, which needs a browser.
    const scanned = await PDFDocument.create()
    scanned.addPage()
    await expect(ingest("c.pdf", buf(await scanned.save()))).rejects.toThrow("pdf-scanned")
  })
})

describe("PDF table layout", () => {
  const page = (glyphs: Glyph[], n = 1): PageData => ({ page: n, width: 595, height: 842, glyphs, rules: [], ocr: false })
  const g = (text: string, x0: number, y: number, h = 10): Glyph => ({ text, x0, x1: x0 + text.length * 5, y, h })

  it("joins a two-line header column by column", () => {
    const { tables } = extractTables([
      page([
        g("Ürün", 40, 100), g("Birim", 200, 100), g("Tutar", 300, 100),
        g("Fiyat", 200, 112),
        g("Çay", 40, 130), g("120,50", 200, 130), g("241,00", 300, 130),
        g("Kahve", 40, 146), g("310,00", 200, 146), g("310,00", 300, 146),
      ]),
    ])
    expect(tables[0]?.matrix).toEqual([
      ["Ürün", "Birim Fiyat", "Tutar"],
      ["Çay", "120,50", "241,00"],
      ["Kahve", "310,00", "310,00"],
    ])
  })

  it("splits columns aligned with runs of spaces inside one text item", () => {
    const line = (s: string, y: number): Glyph => ({ text: s, x0: 40, x1: 40 + s.length * 5, y, h: 10 })
    const { tables } = extractTables([
      page([line("Şehir         Adet     Tutar", 100), line("İzmir         12       1.250,50", 116), line("Ankara        3        99,90", 132)]),
    ])
    expect(tables[0]?.matrix).toEqual([
      ["Şehir", "Adet", "Tutar"],
      ["İzmir", "12", "1.250,50"],
      ["Ankara", "3", "99,90"],
    ])
  })
})

describe("scanned number cross-check", () => {
  // Row r, column c occupies x 100c…100c+60, y 20r…20r+12 on page 1.
  const box = (r: number, c: number): CellBox => ({ page: 1, x0: 100 * c, x1: 100 * c + 60, y0: 20 * r, y1: 20 * r + 12, conf: 90 })
  const glyph = (text: string, r: number, c: number): Glyph => ({ text, x0: 100 * c + 5, x1: 100 * c + 50, y: 20 * r + 11, h: 10 })
  const table = (matrix: (string | null)[][]): PdfTable => ({
    matrix,
    boxes: matrix.map((row, r) => row.map((v, c) => (v === null ? null : box(r, c)))),
    pages: [1, 1],
    ocr: true,
  })

  it("accepts agreeing readings, fixes by majority, and marks disagreement instead of guessing", async () => {
    const first = table([
      ["Ürün", "Adet", "Tutar"],
      ["Çay", "2", "241,00"],
      ["Kahve", "ak", "52,10"],
      ["Süt", "3", "52,10"],
      ["Bal", "4", "99,90"],
    ])
    const second = [
      glyph("2", 1, 1), glyph("241,00", 1, 2),
      glyph("1", 2, 1), glyph("52,70", 2, 2),
      glyph("3", 3, 1), glyph("52,70", 3, 2),
      glyph("4", 4, 1), glyph("99,90", 4, 2),
    ]
    const asked: CellBox[] = []
    const third: Record<string, string> = { "2,1": "1", "2,2": "52,70", "3,2": "52,40" }
    const { table: out, stats } = await verifyOcrTable(first, new Map([[1, second]]), async (boxes) => {
      asked.push(...boxes)
      return boxes.map((b) => [{ text: third[`${b.y0 / 20},${b.x0 / 100}`] ?? "", conf: 95 }])
    })
    expect(out.matrix).toEqual([
      ["Ürün", "Adet", "Tutar"],
      ["Çay", "2", "241,00"],
      ["Kahve", "1", "52,70"],
      ["Süt", "3", "52,10 (?)"],
      ["Bal", "4", "99,90"],
    ])
    // Only cells where the two engines disagreed were read again.
    expect(asked).toHaveLength(3)
    expect(stats).toEqual({ checkedCells: 8, correctedCells: 2, uncertainCells: 1 })
  })

  it("leaves text-layer tables alone", async () => {
    const t = { ...table([["a", "1"], ["b", "2"], ["c", "3"]]), ocr: false }
    const { table: out } = await verifyOcrTable(t, new Map(), async () => {
      throw new Error("must not re-read")
    }).catch(() => ({ table: t }))
    expect(out.matrix).toEqual(t.matrix)
  })
})

describe("scanned number cross-check: confusable letters", () => {
  it("counts 'l' and 'O' as digits in a vote but never accepts a single reading", async () => {
    const box = (r: number): CellBox => ({ page: 1, x0: 0, x1: 40, y0: 20 * r, y1: 20 * r + 12, conf: 90 })
    const t: PdfTable = {
      matrix: [["Adet"], ["l"], ["1O"], ["3"], ["4"]],
      boxes: [[box(0)], [box(1)], [box(2)], [box(3)], [box(4)]],
      pages: [1, 1],
      ocr: true,
    }
    const second: Glyph[] = [
      { text: "1", x0: 5, x1: 20, y: 31, h: 10 },
      { text: "3", x0: 5, x1: 20, y: 71, h: 10 },
      { text: "4", x0: 5, x1: 20, y: 91, h: 10 },
    ]
    const { table, stats } = await verifyOcrTable(t, new Map([[1, second]]), async (boxes) => boxes.map(() => []))
    // "l" + second reading "1" agree → 1. "1O" has no second agreeing reading → marked, not guessed.
    expect(table.matrix.map((r) => r[0])).toEqual(["Adet", "1", "1O (?)", "3", "4"])
    expect(stats.uncertainCells).toBe(1)
  })
})

it("accepts a value only when two independent digit readings agree", async () => {
  const box = (r: number, c: number): CellBox => ({ page: 1, x0: 100 * c, x1: 100 * c + 40, y0: 20 * r, y1: 20 * r + 12, conf: 60 })
  const rows = [["Adet", "Tutar"], ["al", "12,50"], ["is", "3,00"], ["3", "4,00"], ["4", "5,00"]]
  const t: PdfTable = { matrix: rows, boxes: rows.map((row, r) => row.map((_, c) => box(r, c))), pages: [1, 1], ocr: true }
  // The second engine agrees on every price and on the last two quantities.
  const second: Glyph[] = rows.slice(1).flatMap((row, i) =>
    row.flatMap((v, c) => (c === 1 || i >= 2 ? [{ text: v, x0: 100 * c + 5, x1: 100 * c + 30, y: 20 * (i + 1) + 11, h: 10 }] : [])),
  )
  const { table } = await verifyOcrTable(t, new Map([[1, second]]), async (boxes) =>
    boxes.map((b) => (b.y0 === 20 ? [{ text: "1", conf: 95 }, { text: "1", conf: 90 }] : [{ text: "7", conf: 95 }, { text: "1", conf: 90 }])),
  )
  expect(table.matrix.map((r) => r[0])).toEqual(["Adet", "1", "is (?)", "3", "4"])
})

it("keeps a table's last row on each page even when it sits in the footer zone", () => {
  // 3 pages; each page's last data row is at y = 780 (bottom 12% of an 842pt page) and looks
  // alike once digits are masked. The page number line below it is real furniture.
  const g = (text: string, x0: number, y: number): Glyph => ({ text, x0, x1: x0 + text.length * 5, y, h: 10 })
  const pages: PageData[] = [1, 2, 3].map((n) => ({
    page: n,
    width: 595,
    height: 842,
    rules: [],
    ocr: false,
    glyphs: [
      g("Şube", 40, 748), g("Tutar", 300, 748),
      g("Beşiktaş", 40, 764), g(`${n}00,00`, 300, 764),
      g("Kadıköy", 40, 780), g(`${n}.250,50`, 300, 780),
      g(`Sayfa ${n} / 3`, 260, 830),
    ],
  }))
  const { tables, stats } = extractTables(pages)
  const rows = tables.flatMap((t) => t.matrix).filter((r) => r[0] === "Kadıköy")
  expect(rows).toHaveLength(3)
  expect(stats.droppedPageFurniture).toBe(3)
})

it("keeps the sign of an accounting negative when digit engines fix its digits", async () => {
  const box = (r: number, c: number): CellBox => ({ page: 1, x0: 100 * c, x1: 100 * c + 60, y0: 20 * r, y1: 20 * r + 12, conf: 60 })
  const rows = [["Açıklama", "Tutar"], ["İade", "(1.250,5O)"], ["Satış", "12,00"]]
  const t: PdfTable = { matrix: rows, boxes: rows.map((row, r) => row.map((_, c) => box(r, c))), pages: [1, 1], ocr: true }
  const second: Glyph[] = [
    { text: "(1.260,50)", x0: 105, x1: 150, y: 31, h: 10 },
    { text: "12,00", x0: 105, x1: 150, y: 51, h: 10 },
  ]
  const { table } = await verifyOcrTable(t, new Map([[1, second]]), async (boxes) => boxes.map(() => [{ text: "1.250,50", conf: 95 }, { text: "1.250,50", conf: 90 }]))
  expect(table.matrix[1]?.[1]).toBe("-1.250,50")
})

import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { decodeText } from "@/lib/ingest/decode"
import { ingest } from "@/lib/ingest"
import { detectHeaderRow, isTotalRow, sanitizeName, tidyMatrix } from "@/lib/ingest/tidy"

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

const corporate = [
  ["ACME A.Ş. — 2025 Satış Raporu"],
  [],
  ["Rapor tarihi:", "05.01.2025"],
  [],
  ["Şehir 🏙️", "İlçe", "Ürün (Adı)", "Tutar (TL)", "Tutar (TL)", null, "2024", "İade Nedeni"],
  ["İstanbul", "Kadıköy", "Çay", 1250.5, 10, null, "a", null],
  ["İzmir", "Bornova", "Şeker", 99.9, 11, null, "b", null],
  [null, null, null, null, null, null, null, null],
  ["Ankara", "Çankaya", "Kahve", 3000, 12, null, "c", "Hasarlı"],
  ["Bursa", "Nilüfer", "Çay", 10, 13, null, "d", null],
  ["Konya", "Selçuklu", "Su", 5, 14, null, "e", null],
  ["Adana", "Seyhan", "Süt", 7, 15, null, "f", null],
  ["TOPLAM", null, null, 4362.4, 75, null, null, null],
]

describe("Excel ingestion", () => {
  it("offers a sheet selector when several sheets have data, skipping empty ones", async () => {
    const data = workbook({ Kapak: [["Yıllık rapor"]], Satışlar: corporate, Boş: [] })
    expect(await ingest("rapor.xlsx", data)).toEqual({
      kind: "sheets",
      tables: null,
      sheets: [
        { name: "Kapak", rows: 1, columns: 1 },
        { name: "Satışlar", rows: 10, columns: 8 },
      ],
    })
  })

  it("finds the header under the banner, drops blanks/ghosts/totals and sanitizes names", async () => {
    const res = await ingest("rapor.xlsx", workbook({ Kapak: [["x"]], Satışlar: corporate }), "Satışlar")
    if (res.kind !== "table") throw new Error("expected table")
    const [header, ...lines] = res.csv.split("\r\n")
    expect(header).toBe("sehir,ilce,urun_adi,tutar_tl,tutar_tl_1,kolon_2024,iade_nedeni")
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe("İstanbul,Kadıköy,Çay,1250.5,10,a,")
    expect(lines[2]).toBe("Ankara,Çankaya,Kahve,3000,12,c,Hasarlı")
    expect(res.report).toMatchObject({
      source: "excel",
      sheet: "Satışlar",
      headerRow: 5,
      skippedTopRows: 4,
      droppedEmptyRows: 1,
      droppedEmptyColumns: 1,
      droppedTotalRows: ["TOPLAM"],
      rowCount: 6,
      columnCount: 7,
    })
    expect(res.report.renamedColumns).toContainEqual({ from: "Şehir 🏙️", to: "sehir" })
    expect(res.report.renamedColumns).toContainEqual({ from: "Tutar (TL)", to: "tutar_tl_1" })
  })

  it("keeps a named but sparse column (real data, not a ghost)", async () => {
    const res = await ingest("r.xlsx", workbook({ S: corporate }))
    if (res.kind !== "table") throw new Error("expected table")
    expect(res.csv.split("\r\n")[0]).toContain("iade_nedeni")
  })
})

describe("CSV ingestion", () => {
  it.each([
    [",", "sehir,tutar\nİzmir,10\nAnkara,20"],
    [";", "sehir;tutar\nİzmir;1.250,50\nAnkara;20"],
    [";", "ilce;tutar\nİzmir;12,50\nBeşiktaş;1.015,85\nŞişli;90,20"],
    ["\t", "sehir\ttutar\nİzmir\t10\nAnkara\t20"],
    ["|", "sehir|tutar\nİzmir|10\nAnkara|20"],
  ])("sniffs the %j delimiter", async (delimiter, text) => {
    const res = await ingest("a.csv", enc(text))
    if (res.kind !== "table") throw new Error("expected table")
    expect(res.report.delimiter).toBe(delimiter)
    expect(res.csv.split("\r\n")[1]).toMatch(/^İzmir,/)
  })

  it("quotes values that contain commas after re-serializing", async () => {
    const res = await ingest("a.csv", enc("urun;tutar\nKazak, yün;1.250,50\nMont;20"))
    if (res.kind !== "table") throw new Error("expected table")
    expect(res.csv).toBe('urun,tutar\r\n"Kazak, yün","1.250,50"\r\nMont,20')
  })

  it("reads Windows-1254 and UTF-16 exports without mangling Turkish letters", async () => {
    const cp1254 = new Uint8Array([0x53, 0x65, 0x68, 0x69, 0x72, 0x3b, 0x4e, 0x0a, 0xde, 0x69, 0xfe, 0x6c, 0x69, 0x3b, 0x31]) // "Sehir;N\nŞişli;1"
    expect(decodeText(cp1254)).toEqual({ text: "Sehir;N\nŞişli;1", encoding: "windows-1254" })
    const u16 = new Uint8Array([0xff, 0xfe, ...Array.from("Şehir\tN\nİzmir\t1").flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])])
    const res = await ingest("u.txt", u16.buffer)
    if (res.kind !== "table") throw new Error("expected table")
    expect(res.report.encoding).toBe("utf-16le")
    expect(res.csv).toBe("sehir,n\r\nİzmir,1")
  })

  it("names columns of headerless numeric data", async () => {
    const res = await ingest("n.csv", enc("1,2,3\n4,5,6\n7,8,9"))
    if (res.kind !== "table") throw new Error("expected table")
    expect(res.report.headerRow).toBe(0)
    expect(res.csv.split("\r\n")).toEqual(["kolon_1,kolon_2,kolon_3", "1,2,3", "4,5,6", "7,8,9"])
  })
})

describe("tidy rules", () => {
  it("drops rows that are more than 90% empty in wide tables", async () => {
    const header = Array.from({ length: 11 }, (_, i) => `k${i}`)
    const full = Array.from({ length: 11 }, (_, i) => String(i))
    const sparse = ["yalnız", ...Array.from({ length: 10 }, () => null)]
    const t = tidyMatrix([header, full, sparse, full])
    expect(t.rows).toHaveLength(2)
    expect(t.report.droppedEmptyRows).toBe(1)
  })

  it("recognizes summary rows only when the label is exactly a total keyword", async () => {
    expect(isTotalRow(["GENEL TOPLAM:", "5"])).toBe("GENEL TOPLAM:")
    expect(isTotalRow([null, "Total", "5"])).toBe("Total")
    expect(isTotalRow(["Ortalama", "3"])).toBe("Ortalama")
    expect(isTotalRow(["Toplam Kalite Ltd.", "5"])).toBeNull()
    expect(isTotalRow(["İstanbul", "5"])).toBeNull()
  })

  it("sanitizes names for DuckDB", async () => {
    expect(sanitizeName("Tutar (TL) 💰")).toBe("tutar_tl")
    expect(sanitizeName("  Müşteri Adı/Soyadı ")).toBe("musteri_adi_soyadi")
    expect(sanitizeName("İL")).toBe("il")
    expect(sanitizeName("2024 Ciro")).toBe("kolon_2024_ciro")
    expect(sanitizeName("🔥🔥")).toBe("")
  })

  it("prefers the real header over a two-cell banner line", async () => {
    const m = [["Rapor:", "Satış"], ["Şehir", "İlçe", "Tutar"], ["A", "B", "1"], ["C", "D", "2"]]
    expect(detectHeaderRow(m, 3)).toBe(1)
  })
})

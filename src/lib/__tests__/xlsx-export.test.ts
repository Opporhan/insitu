import { describe, expect, it } from "vitest"
import { read, utils } from "xlsx"
import { buildXlsx } from "@/lib/xlsx-export"
import type { OutputColumn } from "@/lib/schema"

describe("buildXlsx", () => {
  it("writes typed cells: numbers with formats, real dates, plain text", () => {
    const columns: OutputColumn[] = [
      { key: "sehir", label: "Şehir", format: "text", total: false },
      { key: "tarih", label: "Tarih", format: "date", total: false },
      { key: "ciro", label: "Ciro", format: "currency", total: true },
      { key: "pay", label: "Pay", format: "percent", total: false },
    ]
    const rows = [
      { sehir: "İstanbul", tarih: "2025-01-05", ciro: 1250.5, pay: 12.5 },
      { sehir: "=HYPERLINK(\"x\")", tarih: "2025-02-06 14:30", ciro: null, pay: 87.5 },
    ]
    const book = read(buildXlsx(columns, rows, "tr", "Şehirlere Göre / Ciro"), { cellNF: true })
    const name = book.SheetNames[0] ?? ""
    expect(name).toBe("Şehirlere Göre Ciro")
    const s = book.Sheets[name]!
    expect(s["A1"]?.v).toBe("Şehir")
    expect(s["C2"]).toMatchObject({ t: "n", v: 1250.5, z: '"₺"#,##0.00' })
    expect(s["D2"]).toMatchObject({ t: "n", v: 12.5 })
    expect(s["B2"]).toMatchObject({ t: "n", v: 45662, z: "dd.mm.yyyy" })
    expect(s["B3"]?.z).toBe("dd.mm.yyyy hh:mm")
    // Text is text (never a formula), and empty values stay empty.
    expect(s["A3"]).toMatchObject({ t: "s" })
    expect(s["A3"]?.f).toBeUndefined()
    expect(s["C3"]).toBeUndefined()
    expect(utils.sheet_to_json(s)).toHaveLength(2)
  })
})

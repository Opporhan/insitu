import { describe, expect, it } from "vitest"
import { followUpQuestions, humanize, isIdLike, suggestQuestions } from "@/lib/suggestions"
import type { Column } from "@/lib/schema"

const firma: Column[] = [
  { name: "s_n", type: "number" },
  { name: "firma_kodu", type: "text" },
  { name: "firma_adi", type: "text" },
  { name: "tarih", type: "date" },
  { name: "tutar_tl", type: "number" },
]
const originals = new Map([
  ["s_n", "S/N"],
  ["firma_kodu", "Firma Kodu"],
  ["firma_adi", "Firma Adı"],
  ["tarih", "Tarih 📅"],
  ["tutar_tl", "Tutar (TL) 💰"],
])

describe("suggestQuestions", () => {
  it("never shows raw column names or identifier columns", () => {
    const tr = suggestQuestions(firma, "tr", originals)
    expect(tr).toEqual([
      "Toplam tutar en yüksek olan firma adı hangisi?",
      "Toplam tutar aylara göre nasıl değişti?",
      "Toplam tutar firma adı bazında nasıl dağılıyor?",
    ])
    expect(tr.join(" ")).not.toMatch(/_|s_n|kodu/)
  })

  it("switches to English with the UI language", () => {
    expect(suggestQuestions(firma, "en", originals)).toEqual([
      "Which company name has the highest total amount?",
      "How did total amount change month by month?",
      "How is total amount split by company name?",
    ])
  })

  it("humanizes snake_case names when the original header is unknown", () => {
    expect(
      suggestQuestions(
        [
          { name: "sehir", type: "text" },
          { name: "birim_fiyat", type: "number" },
          { name: "toplam_ciro", type: "number" },
        ],
        "tr",
      )[0],
    ).toBe("Toplam ciro en yüksek olan şehir hangisi?")
  })

  it("uses record counts when there is no measure", () => {
    expect(suggestQuestions([{ name: "sehir", type: "text" }, { name: "tarih", type: "date" }], "tr", new Map([["sehir", "Şehir"]]))).toEqual([
      "En sık geçen şehir hangisi?",
      "Kayıt sayısı aylara göre nasıl değişti?",
      "Kayıtlar şehir bazında nasıl dağılıyor?",
    ])
  })
})

describe("isIdLike / humanize", () => {
  it.each(["s_n", "S/N", "firma_kodu", "Sipariş No", "musteri_id", "Sıra No", "ID", "urun_kod"])("%s is an identifier", (n) => {
    expect(isIdLike(n)).toBe(true)
  })
  it.each(["tutar", "sehir", "firma_adi", "kodlama_dili", "notlar"])("%s is not an identifier", (n) => {
    expect(isIdLike(n)).toBe(false)
  })
  it("cleans headers into everyday words", () => {
    expect(humanize("tutar_tl", "Tutar (TL) 💰")).toBe("tutar")
    expect(humanize("kdv_tutari", "KDV Tutarı")).toBe("KDV tutarı")
    expect(humanize("firma_kodu")).toBe("firma kodu")
    expect(humanize("il", "İL")).toBe("il")
  })

  it("restores Turkish letters in ASCII headers but never touches correct ones", () => {
    expect(humanize("odeme_yontemi")).toBe("ödeme yöntemi")
    expect(humanize("sube_adi")).toBe("şube adı")
    expect(humanize("sehir", "Şehir")).toBe("şehir")
    expect(humanize("proje_kodu_x")).toBe("proje kodu x")
  })

  it("translates names to English only when every word is known", () => {
    expect(humanize("satis_tutari", "Satış Tutarı", "en")).toBe("sales amount")
    expect(humanize("odeme_yontemi", undefined, "en")).toBe("payment method")
    expect(humanize("sube_adi", "Şube Adı", "en")).toBe("branch name")
    // Unknown word → keep the original name rather than a half translation.
    expect(humanize("proje_butcesi", "Proje Bütçesi", "en")).toBe("proje bütçesi")
  })
})

describe("followUpQuestions", () => {
  const cols = [
    { name: "sehir", type: "text" as const },
    { name: "kategori", type: "text" as const },
    { name: "tarih", type: "date" as const },
    { name: "tutar", type: "number" as const },
  ]
  it("does not offer a breakdown the answer already has", () => {
    expect(followUpQuestions(cols, "tr", new Map(), 'SELECT "sehir", SUM("tutar") FROM data GROUP BY 1')).toEqual([
      "Sadece ilk 5'i göster",
      "Bunu aylara göre göster",
      "Bunu kategori bazında göster",
    ])
    expect(followUpQuestions(cols, "tr", new Map(), `SELECT strftime(date_trunc('month', "tarih"), '%Y-%m') AS ay, "sehir" FROM data`)).toEqual([
      "Sadece ilk 5'i göster",
      "Bunu kategori bazında göster",
    ])
  })
})

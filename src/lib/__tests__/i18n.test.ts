import { describe, expect, it } from "vitest"
import { toCsv } from "@/lib/export"
import { localeFromAcceptLanguage, messages, requestLocale } from "@/lib/i18n"
import { TranslateRequest } from "@/lib/schema"

describe("locale selection", () => {
  it("prefers the cookie, then the browser's first language, defaulting to Turkish", () => {
    expect(requestLocale("a=1; insitu-locale=en", "tr-TR")).toBe("en")
    expect(requestLocale("insitu-locale=xx", "en-GB,en;q=0.9")).toBe("en")
    expect(requestLocale(null, "de-DE,en;q=0.5")).toBe("tr")
    expect(localeFromAcceptLanguage(null)).toBe("tr")
  })

  it("has the same message keys in both languages", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((c) => `${k}.${c}`) : [k]))
    expect(keys(messages.en).sort()).toEqual(keys(messages.tr).sort())
  })
})

describe("TranslateRequest locale", () => {
  const base = { question: "top 3", columns: [{ name: "city", type: "text" }] }
  it("accepts tr/en and rejects anything else", () => {
    expect(TranslateRequest.safeParse({ ...base, locale: "en" }).success).toBe(true)
    expect(TranslateRequest.safeParse({ ...base, locale: "de" }).success).toBe(false)
  })
})

describe("English CSV", () => {
  it("uses comma separators and dot decimals", () => {
    expect(
      toCsv(
        [
          { key: "k", label: "City", format: "text", total: false },
          { key: "v", label: "Revenue", format: "currency", total: true },
        ],
        [{ k: "Istanbul, TR", v: 1250.5 }],
        "en",
      ),
    ).toBe('City,Revenue\r\n"Istanbul, TR",1250.5')
  })
})

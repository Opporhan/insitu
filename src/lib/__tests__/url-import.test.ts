import { describe, expect, it } from "vitest"
import { fetchImport, fileNameFrom, resolveImportUrl } from "@/lib/url-import"

describe("resolveImportUrl", () => {
  it("turns Google Sheets share, edit and published links into an .xlsx export", () => {
    const id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
    expect(resolveImportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=0`)).toMatchObject({
      url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
      source: "sheets",
    })
    expect(resolveImportUrl("https://docs.google.com/spreadsheets/d/e/2PACX-1vABC_def-123/pubhtml")).toMatchObject({
      url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vABC_def-123/pub?output=xlsx",
    })
  })

  it("turns GitHub file pages into raw file links and keeps the file name", () => {
    expect(resolveImportUrl("https://github.com/Opporhan/insitu/blob/main/public/samples/satislar.csv")).toEqual({
      url: "https://raw.githubusercontent.com/Opporhan/insitu/main/public/samples/satislar.csv",
      fileName: "satislar.csv",
      source: "github",
    })
  })

  it("refuses other hosts, non-https and non-table files", () => {
    expect(resolveImportUrl("https://example.com/data.csv")).toBe("url-unsupported")
    expect(resolveImportUrl("http://docs.google.com/spreadsheets/d/xyz")).toBe("url-invalid")
    expect(resolveImportUrl("not a url")).toBe("url-invalid")
    expect(resolveImportUrl("https://raw.githubusercontent.com/a/b/main/script.js")).toBe("url-unsupported")
  })
})

describe("fetchImport", () => {
  const target = { url: "https://docs.google.com/spreadsheets/d/x/export?format=xlsx", fileName: "google-sheets.xlsx", source: "sheets" as const }
  const respond = (body: string, init: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch

  it("names the file from Content-Disposition (UTF-8 names included)", async () => {
    const file = await fetchImport(
      target,
      respond("x", { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": "attachment; filename=\"x.xlsx\"; filename*=UTF-8''Sat%C4%B1%C5%9Flar.xlsx" } }),
    )
    expect(file instanceof File && file.name).toBe("Satışlar.xlsx")
    expect(fileNameFrom(null, "f.xlsx")).toBe("f.xlsx")
  })

  it("recognizes a private sheet (sign-in page) and failures", async () => {
    expect(await fetchImport(target, respond("<html>", { status: 200, headers: { "content-type": "text/html" } }))).toBe("url-private")
    expect(await fetchImport(target, respond("", { status: 404 }))).toBe("url-failed")
    const failing = (async () => {
      throw new TypeError("network")
    }) as unknown as typeof fetch
    expect(await fetchImport(target, failing)).toBe("url-failed")
  })
})

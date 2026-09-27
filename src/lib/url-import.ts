/**
 * Opening a table from a link, downloaded straight into the browser (never through our
 * server, so the data still reaches no server of ours). Only sources that allow browser
 * downloads (CORS) and that the Content-Security-Policy lists are supported:
 * Google Sheets (as .xlsx, all sheets with real types) and files on GitHub.
 */

export type ImportTarget = { url: string; fileName: string; source: "sheets" | "github" }
export type ImportError = "url-invalid" | "url-unsupported"

/** Hosts the page may fetch from (kept in sync with connect-src in next.config.ts). */
export const IMPORT_HOSTS = ["docs.google.com", "*.googleusercontent.com", "raw.githubusercontent.com", "gist.githubusercontent.com"] as const

const FILE_EXT = /\.(csv|tsv|txt|xlsx|xls|xlsm|pdf)$/i

export function resolveImportUrl(input: string): ImportTarget | ImportError {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return "url-invalid"
  }
  if (u.protocol !== "https:") return "url-invalid"

  if (u.hostname === "docs.google.com") {
    // Published to the web: /spreadsheets/d/e/<pub id>/pubhtml → /pub?output=xlsx
    const published = /^\/spreadsheets\/d\/e\/([\w-]+)/.exec(u.pathname)
    if (published) {
      return { url: `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=xlsx`, fileName: "google-sheets.xlsx", source: "sheets" }
    }
    // Shared or edit link: /spreadsheets/d/<id>/edit… → /export?format=xlsx (every sheet).
    const shared = /^\/spreadsheets\/d\/([\w-]{20,})/.exec(u.pathname)
    if (shared) {
      return { url: `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=xlsx`, fileName: "google-sheets.xlsx", source: "sheets" }
    }
    return "url-unsupported"
  }

  if (u.hostname === "raw.githubusercontent.com" || u.hostname === "gist.githubusercontent.com") {
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "")
    return FILE_EXT.test(name) ? { url: u.toString(), fileName: name, source: "github" } : "url-unsupported"
  }
  if (u.hostname === "github.com") {
    // github.com/<owner>/<repo>/blob/<ref>/<path> → raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
    const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(u.pathname)
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "")
    if (m && FILE_EXT.test(name)) {
      return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, fileName: name, source: "github" }
    }
  }
  return "url-unsupported"
}

/** "attachment; filename="x.xlsx"; filename*=UTF-8''Sat%C4%B1%C5%9F.xlsx" → "Satış.xlsx". */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain?.[1]?.trim() || fallback
}

/** Largest file downloaded from a link (the same engine limits apply as for dropped files). */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024
const IMPORT_TIMEOUT_MS = 60_000

export type FetchError = "url-private" | "url-failed" | "url-too-large"

export async function fetchImport(target: ImportTarget, fetcher: typeof fetch = fetch): Promise<File | FetchError> {
  let res: Response
  try {
    res = await fetcher(target.url, { credentials: "omit", redirect: "follow", signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS) })
  } catch {
    return "url-failed"
  }
  const type = res.headers.get("content-type") ?? ""
  // A sheet that is not shared publicly answers with Google's sign-in page (HTML) or 401/403.
  if (res.status === 401 || res.status === 403 || (target.source === "sheets" && type.includes("text/html"))) return "url-private"
  if (!res.ok) return "url-failed"
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES) return "url-too-large"
  const blob = await res.blob()
  if (blob.size > MAX_IMPORT_BYTES) return "url-too-large"
  const name = target.source === "sheets" ? fileNameFrom(res.headers.get("content-disposition"), target.fileName) : target.fileName
  return new File([blob], name, { type: blob.type })
}

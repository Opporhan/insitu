/**
 * All user-facing text, for server and client. `en` must have exactly the shape of
 * `tr` (the `Messages` type), so a missing translation is a compile error.
 */

export const LOCALES = ["tr", "en"] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "tr"
export const LOCALE_COOKIE = "insitu-locale"
export const INTL_LOCALE: Record<Locale, string> = { tr: "tr-TR", en: "en-US" }

export function parseLocale(value: string | null | undefined): Locale | null {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : null
}

/** First visit: English only when the browser's first preference is English. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  const first = header?.split(",")[0]?.trim().toLowerCase() ?? ""
  return first.startsWith("en") ? "en" : DEFAULT_LOCALE
}

/** Locale from the preference cookie, else the Accept-Language header. */
export function requestLocale(cookieHeader: string | null, acceptLanguage: string | null): Locale {
  const fromCookie = cookieHeader
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === LOCALE_COOKIE)?.[1]
  return parseLocale(fromCookie) ?? localeFromAcceptLanguage(acceptLanguage)
}

type CleanKey = "tr-number" | "us-thousands" | "dmy-date" | "mdy-date"

const tr = {
  languageName: "Türkçe",
  meta: {
    title: "Insitu — Tablonla konuş",
    description: "CSV ve Excel tablolarına günlük dille soru sor. Hesaplama tarayıcında yapılır, verin cihazından çıkmaz.",
  },
  header: {
    privacy: "Veri cihazında kalır",
    theme: "Aydınlık / karanlık tema",
    language: "Dil",
  },
  hero: {
    title: "Tablonla konuş.",
    body: "Dosyanı bırak, sorunu bir iş arkadaşına sorar gibi yaz. Hesaplama tamamen tarayıcında yapılır; verin bu cihazdan çıkmaz.",
  },
  dropzone: {
    loading: "Tablon tarayıcında okunuyor…",
    drop: "CSV veya Excel dosyanı buraya bırak",
    orClick: "ya da seçmek için tıkla",
    privacy: "Dosya hiçbir sunucuya yüklenmez",
    sample: "Örnek satış verisiyle dene",
  },
  file: {
    unsupported: "Şimdilik yalnızca CSV ve Excel dosyaları destekleniyor.",
    readFailed: (detail: string) => `Dosya okunamadı: ${detail}`,
    codes: {
      "no-sheet": "Excel dosyasında sayfa bulunamadı.",
      "no-columns": "Dosyada sütun bulunamadı.",
    } as Record<string, string>,
  },
  dataset: {
    summary: (rows: string, columns: number) => `${rows} satır · ${columns} sütun`,
    cleaned: (n: number) => `${n} sütun temizlendi`,
    close: "Dosyayı kapat",
    cleanNotes: {
      "tr-number": "Türkçe sayı biçimi (1.250,50) sayıya çevrildi",
      "us-thousands": "Binlik virgüllü sayı (1,250.50) sayıya çevrildi",
      "dmy-date": "GG.AA.YYYY tarihleri tarihe çevrildi",
      "mdy-date": "AA/GG/YYYY tarihleri tarihe çevrildi",
    } satisfies Record<CleanKey, string>,
    currencyStripped: "para birimi/yüzde işaretleri temizlendi",
  },
  ask: {
    label: "Tablona bir soru sor",
    placeholder: "Bu ay en çok kazandıran ilk 3 ürünü göster",
    submit: "Sor",
    examples: "Örnek sorular",
    computing: "Hesaplanıyor",
    translateFailed: "Soru şu an çevrilemedi, lütfen tekrar dene.",
    computeFailed: (detail: string) => `Hesaplama sırasında bir sorun oluştu: ${detail}`,
    followUp: (question: string) => `Takip sorusu sorabilirsin — önceki: “${question}”`,
    newTopic: "Yeni konu",
  },
  result: {
    region: "Sonuç",
    empty: "Bu soruya uyan kayıt bulunamadı.",
    insight: "İçgörü",
    exportTitle: "İndir",
    copy: "Tabloyu panoya kopyala",
    copied: "Kopyalandı",
    copyHint: "Kopyalanan tablo Excel veya Sheets'e doğrudan yapıştırılabilir.",
    exportFailed: "İşlem tamamlanamadı; tarayıcı izin vermemiş olabilir.",
    how: "Bu analizi nasıl hesapladım?",
    howSent: (n: number, context: number) =>
      context > 0
        ? `Yapay zekâya yalnızca sorun, önceki ${context} sorunun metni ve SQL'i (sonuçları değil) ve ${n} sütun adı gitti:`
        : `Yapay zekâya yalnızca sorun ve ${n} sütun adı gitti:`,
    howRan: (rows: string) => `Dönen sorgu, tarayıcında DuckDB ile ${rows} satır üzerinde çalıştı:`,
    listTotal: "Listenin toplamı",
    slices: "Dilimler",
  },
  suggestions: {
    top: (measure: string, dim: string) => `En yüksek ${measure} değerine sahip ilk 5 ${dim}`,
    trend: (measure: string) => `Aylık ${measure} trendi`,
    share: (dim: string, measure: string) => `${dim} bazında ${measure} dağılımı`,
    rowCount: "kayıt sayısı",
  },
  insight: {
    other: "Diğer",
    empty: "Bu soruya uyan kayıt bulunamadı.",
    noNumbers: "Gösterilecek sayısal değer bulunamadı.",
    tablePartial: (n: number) =>
      `Sonuç çok büyük; ilk ${n} satır gösteriliyor. Grafik ve toplamlar kısmi veriyle yanlış olacağından gösterilmiyor — soruyu daraltmayı veya gruplamayı dene.`,
    tableTruncated: (n: number) => `Sonuç ${n}'den fazla satır içeriyor; ilk ${n} satır gösteriliyor.`,
    tableRows: (n: string) => `${n} satırlık sonuç bulundu.`,
    tableTotal: (label: string, rows: string, value: string) => {
      const lower = label.toLocaleLowerCase("tr")
      return `${lower.startsWith("toplam") ? label : `Toplam ${lower}`} (listelenen ${rows} satır): ${value}`
    },
    pie: (name: string, share: string, value: string) => `"${name}", ${share} ile en büyük paya sahip (${value}).`,
    pieTotal: (total: string) => ` Toplam: ${total}.`,
    single: (label: string, value: string) => `${label}: ${value}.`,
    allEqual: (value: string) => `Tüm değerler eşit: ${value}.`,
    maxMin: (maxLabel: string, maxValue: string, minLabel: string, minValue: string) =>
      `En yüksek: ${maxLabel} (${maxValue}); en düşük: ${minLabel} (${minValue}).`,
    diff: (ratio: string) => ` En yüksek değer, en düşükten ${ratio} fazla.`,
    shownSum: (n: number, value: string) => ` Gösterilen ${n} kalemin toplamı: ${value}.`,
    seriesLead: (x: string, series: string, value: string) => `Son dönemde (${x}) en yüksek: ${series} (${value}).`,
    cumulative: (x: string, value: string) => `Kümülatif toplam ${x} itibarıyla ${value} seviyesine ulaştı.`,
    trend: (fromX: string, toX: string, fromV: string, toV: string, change: string, peakX: string, peakV: string) =>
      `${fromX} → ${toX}: ${fromV} → ${toV}${change}. Zirve: ${peakX} (${peakV}).`,
    incomplete: (lastX: string, lastV: string, endX: string) =>
      ` Son dönem (${lastX}: ${lastV}) diğerlerinden belirgin düşük; dönem henüz tamamlanmamış olabilir, bu yüzden karşılaştırma ${endX} ile yapıldı.`,
  },
  server: {
    rateLimited: (seconds: number) => `Çok fazla soru gönderildi. Lütfen ${seconds} saniye sonra tekrar dene.`,
    invalid: "Geçersiz istek.",
    quota: "Yapay zekâ kullanım kotası doldu. Yaklaşık bir dakika sonra tekrar dene.",
    unavailable: "Yapay zekâ şu an yanıt veremedi, birazdan tekrar dene.",
    notAnswerable: "Bu soru mevcut sütunlarla cevaplanamıyor.",
    unreliable: "Soru güvenilir bir sorguya çevrilemedi; biraz farklı sormayı dene.",
  },
}

export type Messages = typeof tr

const en: Messages = {
  languageName: "English",
  meta: {
    title: "Insitu — Talk to your table",
    description: "Ask your CSV and Excel files questions in plain language. Everything runs in your browser; your data never leaves your device.",
  },
  header: {
    privacy: "Data stays on your device",
    theme: "Light / dark theme",
    language: "Language",
  },
  hero: {
    title: "Talk to your table.",
    body: "Drop a file and ask the way you'd ask a colleague. All computation happens in your browser; your data never leaves this device.",
  },
  dropzone: {
    loading: "Reading your table in the browser…",
    drop: "Drop your CSV or Excel file here",
    orClick: "or click to choose",
    privacy: "Your file is never uploaded to a server",
    sample: "Try it with sample sales data",
  },
  file: {
    unsupported: "Only CSV and Excel files are supported for now.",
    readFailed: (detail) => `Couldn't read the file: ${detail}`,
    codes: {
      "no-sheet": "No sheet found in the Excel file.",
      "no-columns": "No columns found in the file.",
    },
  },
  dataset: {
    summary: (rows, columns) => `${rows} rows · ${columns} columns`,
    cleaned: (n) => `${n} ${n === 1 ? "column" : "columns"} cleaned`,
    close: "Close file",
    cleanNotes: {
      "tr-number": "Turkish number format (1.250,50) converted to numbers",
      "us-thousands": "Comma-grouped numbers (1,250.50) converted to numbers",
      "dmy-date": "DD.MM.YYYY dates converted to dates",
      "mdy-date": "MM/DD/YYYY dates converted to dates",
    },
    currencyStripped: "currency/percent signs removed",
  },
  ask: {
    label: "Ask your table a question",
    placeholder: "Show the top 3 products by revenue this month",
    submit: "Ask",
    examples: "Example questions",
    computing: "Computing",
    translateFailed: "Couldn't translate the question right now, please try again.",
    computeFailed: (detail) => `Something went wrong while computing: ${detail}`,
    followUp: (question) => `You can ask a follow-up — previous: “${question}”`,
    newTopic: "New topic",
  },
  result: {
    region: "Result",
    empty: "No records match this question.",
    insight: "Insight",
    exportTitle: "Download",
    copy: "Copy table to clipboard",
    copied: "Copied",
    copyHint: "The copied table pastes straight into Excel or Sheets.",
    exportFailed: "Couldn't complete that; the browser may have blocked it.",
    how: "How did I calculate this?",
    howSent: (n, context) =>
      context > 0
        ? `Only your question, the text and SQL of ${context} earlier question${context === 1 ? "" : "s"} (not their results) and ${n} column names were sent to the AI:`
        : `Only your question and ${n} column names were sent to the AI:`,
    howRan: (rows) => `The returned query ran in your browser with DuckDB over ${rows} rows:`,
    listTotal: "List total",
    slices: "Slices",
  },
  suggestions: {
    top: (measure, dim) => `Top 5 ${dim} by ${measure}`,
    trend: (measure) => `Monthly ${measure} trend`,
    share: (dim, measure) => `${measure} breakdown by ${dim}`,
    rowCount: "record count",
  },
  insight: {
    other: "Other",
    empty: "No records match this question.",
    noNumbers: "No numeric values to show.",
    tablePartial: (n) =>
      `The result is very large; showing the first ${n} rows. Charts and totals are hidden because partial data would make them wrong — try narrowing or grouping the question.`,
    tableTruncated: (n) => `The result has more than ${n} rows; showing the first ${n}.`,
    tableRows: (n) => `Found ${n} rows.`,
    tableTotal: (label, rows, value) => {
      const lower = label.toLocaleLowerCase("en")
      return `${lower.startsWith("total") ? label : `Total ${lower}`} (${rows} listed rows): ${value}`
    },
    pie: (name, share, value) => `"${name}" has the largest share at ${share} (${value}).`,
    pieTotal: (total) => ` Total: ${total}.`,
    single: (label, value) => `${label}: ${value}.`,
    allEqual: (value) => `All values are equal: ${value}.`,
    maxMin: (maxLabel, maxValue, minLabel, minValue) =>
      `Highest: ${maxLabel} (${maxValue}); lowest: ${minLabel} (${minValue}).`,
    diff: (ratio) => ` The highest is ${ratio} above the lowest.`,
    shownSum: (n, value) => ` Sum of the ${n} items shown: ${value}.`,
    seriesLead: (x, series, value) => `Latest period (${x}) leader: ${series} (${value}).`,
    cumulative: (x, value) => `The running total reached ${value} as of ${x}.`,
    trend: (fromX, toX, fromV, toV, change, peakX, peakV) => `${fromX} → ${toX}: ${fromV} → ${toV}${change}. Peak: ${peakX} (${peakV}).`,
    incomplete: (lastX, lastV, endX) =>
      ` The last period (${lastX}: ${lastV}) is far below the others and may be incomplete, so the comparison uses ${endX}.`,
  },
  server: {
    rateLimited: (seconds) => `Too many questions. Please try again in ${seconds} seconds.`,
    invalid: "Invalid request.",
    quota: "The AI usage quota is exhausted. Please try again in about a minute.",
    unavailable: "The AI couldn't respond right now, please try again shortly.",
    notAnswerable: "This question can't be answered with the available columns.",
    unreliable: "Couldn't turn the question into a reliable query; try rephrasing it.",
  },
}

export const messages: Record<Locale, Messages> = { tr, en }

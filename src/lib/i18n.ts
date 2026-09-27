/**
 * All user-facing text, for server and client. `en` must have exactly the shape of
 * `tr` (the `Messages` type), so a missing translation is a compile error.
 */

import { capitalize, hasTotalWord } from "@/lib/text"

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
    description: "CSV, Excel ve PDF tablolarına günlük dille soru sor. Hesaplama tarayıcında yapılır, verin cihazından çıkmaz.",
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
    readingPdf: (page: number, pages: number) => `PDF okunuyor: sayfa ${page}/${pages}`,
    ocr: (page: number, pages: number) =>
      `Taranmış sayfa metin tanımayla okunuyor: ${page}/${pages}${page === 1 ? " (ilk seferde tanıma modeli indirilir)" : ""}`,
    drop: "CSV, Excel veya PDF dosyanı buraya bırak",
    orClick: "ya da seçmek için tıkla",
    privacy: "Dosya hiçbir sunucuya yüklenmez",
    sample: "Örnek satış verisiyle dene",
  },
  file: {
    unsupported: "Şimdilik yalnızca CSV, Excel ve PDF dosyaları destekleniyor.",
    readFailed: (detail: string) => `Dosya okunamadı: ${detail}`,
    codes: {
      "no-sheet": "Excel dosyasında sayfa bulunamadı.",
      "no-columns": "Dosyada sütun bulunamadı.",
      "pdf-no-table": "PDF'te tablo bulunamadı. Satır ve sütunlardan oluşan bir tablo içeren bir PDF dene.",
      "pdf-password": "PDF parola korumalı. Parolasız bir kopyasını yükle.",
      "pdf-invalid": "PDF açılamadı; dosya bozuk olabilir.",
      "pdf-scanned": "PDF taranmış görüntülerden oluşuyor ve bu tarayıcı metin tanımayı desteklemiyor.",
      "pdf-render": "Taranmış sayfa görüntüye çevrilemedi.",
      "pdf-ocr-failed": "Metin tanıma tamamlanamadı; internet bağlantını kontrol edip tekrar dene (tanıma modeli ilk seferde indirilir).",
      "engine-timeout": "Hesaplama motoru yüklenemedi; internet bağlantını kontrol edip tekrar dene.",
    } as Record<string, string>,
  },
  sheets: {
    title: "Hangi sekmeyi analiz edelim?",
    body: (file: string) => `“${file}” dosyasında veri içeren birden fazla sekme var.`,
    pdfTitle: "Hangi tabloyu analiz edelim?",
    pdfBody: (file: string) => `“${file}” içinde birden fazla tablo bulundu.`,
    pdfTable: (name: string, pages: [number, number]) =>
      `Tablo ${name} · ${pages[0] === pages[1] ? `sayfa ${pages[0]}` : `sayfa ${pages[0]}–${pages[1]}`}`,
    pdfChange: "Tablo değiştir",
    size: (rows: string, columns: number) => `${rows} dolu satır · ${columns} sütun`,
    cancel: "Vazgeç",
    change: "Sekme değiştir",
  },
  history: {
    title: "Önceki cevaplar",
    count: (n: number) => `${n} cevap`,
    show: "Bu cevabı göster",
  },
  prep: {
    title: "Veri hazırlama raporu ve önizleme",
    previewTitle: (n: number) => `Temizlenmiş verinin ilk ${n} satırı`,
    csvSource: (encoding: string, delimiter: string) => `CSV · ${encoding} kodlama · ayraç: ${delimiter}`,
    excelSource: (sheet: string) => `Excel · “${sheet}” sekmesi`,
    pdfSource: (pages: number, from: number, to: number) =>
      `PDF · ${pages} sayfa · tablo ${from === to ? `${from}. sayfada` : `${from}–${to}. sayfalarda`}`,
    ocrPages: (n: number) => `${n} taranmış sayfa tarayıcıda metin tanıma (OCR) ile okundu`,
    ocrWarning: (n: number) =>
      n > 0
        ? `Metin tanıma ${n} kelimeden emin olamadı; önizlemedeki değerleri orijinal PDF ile karşılaştır`
        : "Metin tanıma sonuçlarını önizlemede orijinal PDF ile karşılaştır",
    ocrSkipped: (n: number) => `${n} taranmış sayfa sınırı aştığı için okunmadı`,
    pageFurniture: (n: number) => `${n} sayfa üst/alt bilgisi satırı (sayfa numarası, rapor başlığı) atıldı`,
    repeatedHeaders: (n: number) => `Her sayfada tekrarlanan ${n} başlık satırı atıldı`,
    wrappedRows: (n: number) => `Alt satıra taşan ${n} hücre metni üstündeki satırla birleştirildi`,
    unreadable: (column: string, n: number) =>
      `${column}: ${n} değer sayı olarak okunamadığı için sütun metin olarak bırakıldı; bu sütunla toplam veya ortalama hesaplanamaz. Önizlemede kontrol et.`,
    encodings: { "utf-8": "UTF-8", "utf-16le": "UTF-16", "utf-16be": "UTF-16", "windows-1254": "Windows-1254 (Türkçe Excel)" } as Record<string, string>,
    delimiters: { ",": "virgül (,)", ";": "noktalı virgül (;)", "\t": "sekme (Tab)", "|": "dikey çizgi (|)" } as Record<string, string>,
    header: (row: number) => `Başlık satırı otomatik bulundu: ${row}. satır`,
    noHeader: "Başlık satırı bulunamadı; kolonlar numaralandırıldı",
    skipped: (n: number) => `Başlığın üstündeki ${n} satır (rapor başlığı, açıklama, boşluk) atıldı`,
    emptyRows: (n: number) => `${n} boş veya büyük kısmı boş satır atıldı`,
    emptyColumns: (n: number) => `${n} boş sütun atıldı`,
    totals: (labels: string) => `Çift saymayı önlemek için özet satırları çıkarıldı: ${labels}`,
    renamed: "Kolon adları sorgulanabilir hâle getirildi:",
    converted: "Biçimi dönüştürülen kolonlar:",
    clean: "Dosya zaten düzenliydi; yapı değişikliği gerekmedi.",
    result: (rows: string, columns: number) => `Hazır tablo: ${rows} satır · ${columns} sütun`,
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
    notNumbers:
      "Bu hesap, sayı olmayan değerler içeren bir sütuna dayanıyor; yanlış bir sonuç göstermemek için durduruldu. Veri hazırlama raporunda hangi sütun olduğunu görebilirsin.",
    followUp: (question: string) => `Takip sorusu sorabilirsin — önceki: “${question}”`,
    newTopic: "Yeni konu",
  },
  result: {
    region: "Sonuç",
    empty: "Bu soruya uyan kayıt bulunamadı.",
    insight: "İçgörü",
    note: "Not",
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
    viewGroup: "Görünüm",
    views: { metric: "Özet", bar: "Çubuk", line: "Çizgi", pie: "Pasta", table: "Tablo" } as Record<string, string>,
    page: (n: number, total: number) => `Sayfa ${n}/${total}`,
    pngPages: (n: number) => `Tabloyu ${n} PNG görseli olarak indir`,
    slices: "Dilimler",
  },
  suggestions: {
    // Column names never take a suffix here, so the sentences stay grammatical for any name.
    // `total` is the measure with "Toplam" in front unless it already contains it.
    total: (measure: string) => (hasTotalWord(measure) ? capitalize(measure, "tr") : `Toplam ${measure}`),
    top: (total: string, dim: string) => `${total} en yüksek olan ${dim} hangisi?`,
    trend: (total: string) => `${total} aylara göre nasıl değişti?`,
    share: (total: string, dim: string) => `${total} ${dim} bazında nasıl dağılıyor?`,
    countTop: (dim: string) => `En sık geçen ${dim} hangisi?`,
    countTrend: "Kayıt sayısı aylara göre nasıl değişti?",
    countShare: (dim: string) => `Kayıtlar ${dim} bazında nasıl dağılıyor?`,
  },
  insight: {
    other: "Diğer",
    empty: "Bu soruya uyan kayıt bulunamadı.",
    noNumbers: "Gösterilecek sayısal değer bulunamadı.",
    tablePartial: (n: number) =>
      `Sonuç çok büyük; ilk ${n} satır gösteriliyor. Grafik ve toplamlar kısmi veriyle yanlış olacağından gösterilmiyor — soruyu daraltmayı veya gruplamayı dene.`,
    tableTruncated: (n: number) => `Sonuç ${n}'den fazla satır içeriyor; ilk ${n} satır gösteriliyor.`,
    tableRows: (n: string) => `${n} satırlık sonuç bulundu.`,
    // No "Toplam" prefix when the label already says it ("Toplam Ciro", "Satış Toplamı").
    tableTotal: (label: string, rows: string, value: string) =>
      `${hasTotalWord(label) ? label : `Toplam ${label.toLocaleLowerCase("tr")}`} (listelenen ${rows} satır): ${value}`,
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
    description: "Ask your CSV, Excel and PDF files questions in plain language. Everything runs in your browser; your data never leaves your device.",
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
    readingPdf: (page, pages) => `Reading PDF: page ${page}/${pages}`,
    ocr: (page, pages) => `Reading scanned page with text recognition: ${page}/${pages}${page === 1 ? " (the recognition model downloads the first time)" : ""}`,
    drop: "Drop your CSV, Excel or PDF file here",
    orClick: "or click to choose",
    privacy: "Your file is never uploaded to a server",
    sample: "Try it with sample sales data",
  },
  file: {
    unsupported: "Only CSV, Excel and PDF files are supported for now.",
    readFailed: (detail) => `Couldn't read the file: ${detail}`,
    codes: {
      "no-sheet": "No sheet found in the Excel file.",
      "no-columns": "No columns found in the file.",
      "pdf-no-table": "No table found in the PDF. Try a PDF that contains a table of rows and columns.",
      "pdf-password": "The PDF is password-protected. Upload a copy without a password.",
      "pdf-invalid": "The PDF couldn't be opened; the file may be damaged.",
      "pdf-scanned": "The PDF consists of scanned images and this browser doesn't support text recognition.",
      "pdf-render": "A scanned page couldn't be turned into an image.",
      "pdf-ocr-failed": "Text recognition couldn't finish; check your connection and try again (the recognition model downloads the first time).",
      "engine-timeout": "The calculation engine couldn't load; check your connection and try again.",
    },
  },
  sheets: {
    title: "Which sheet should we analyze?",
    body: (file) => `“${file}” has more than one sheet with data.`,
    pdfTitle: "Which table should we analyze?",
    pdfBody: (file) => `More than one table was found in “${file}”.`,
    pdfTable: (name, pages) => `Table ${name} · ${pages[0] === pages[1] ? `page ${pages[0]}` : `pages ${pages[0]}–${pages[1]}`}`,
    pdfChange: "Change table",
    size: (rows, columns) => `${rows} filled rows · ${columns} columns`,
    cancel: "Cancel",
    change: "Change sheet",
  },
  history: {
    title: "Earlier answers",
    count: (n) => `${n} answer${n === 1 ? "" : "s"}`,
    show: "Show this answer",
  },
  prep: {
    title: "Data preparation report & preview",
    previewTitle: (n) => `First ${n} rows of the cleaned data`,
    csvSource: (encoding, delimiter) => `CSV · ${encoding} encoding · delimiter: ${delimiter}`,
    excelSource: (sheet) => `Excel · sheet “${sheet}”`,
    pdfSource: (pages, from, to) => `PDF · ${pages} page${pages === 1 ? "" : "s"} · table on ${from === to ? `page ${from}` : `pages ${from}–${to}`}`,
    ocrPages: (n) => `${n} scanned page${n === 1 ? "" : "s"} read in the browser with text recognition (OCR)`,
    ocrWarning: (n) =>
      n > 0
        ? `Text recognition was unsure about ${n} word${n === 1 ? "" : "s"}; compare the preview with the original PDF`
        : "Compare the text recognition results in the preview with the original PDF",
    ocrSkipped: (n) => `${n} scanned page${n === 1 ? "" : "s"} over the limit ${n === 1 ? "was" : "were"} not read`,
    pageFurniture: (n) => `${n} page header/footer line${n === 1 ? "" : "s"} (page numbers, report titles) removed`,
    repeatedHeaders: (n) => `${n} header row${n === 1 ? "" : "s"} repeated on each page removed`,
    wrappedRows: (n) => `${n} cell${n === 1 ? "" : "s"} wrapped onto the next line joined with the row above`,
    unreadable: (column, n) =>
      `${column}: ${n} value${n === 1 ? "" : "s"} couldn't be read as a number, so the column was kept as text and can't be summed or averaged. Check the preview.`,
    encodings: { "utf-8": "UTF-8", "utf-16le": "UTF-16", "utf-16be": "UTF-16", "windows-1254": "Windows-1254 (Turkish Excel)" },
    delimiters: { ",": "comma (,)", ";": "semicolon (;)", "\t": "tab", "|": "pipe (|)" },
    header: (row) => `Header row detected automatically: row ${row}`,
    noHeader: "No header row found; columns were numbered",
    skipped: (n) => `${n} row${n === 1 ? "" : "s"} above the header (report title, notes, blanks) skipped`,
    emptyRows: (n) => `${n} empty or mostly empty row${n === 1 ? "" : "s"} removed`,
    emptyColumns: (n) => `${n} empty column${n === 1 ? "" : "s"} removed`,
    totals: (labels) => `Summary rows removed to avoid double counting: ${labels}`,
    renamed: "Column names made queryable:",
    converted: "Columns whose format was converted:",
    clean: "The file was already tidy; no structural changes needed.",
    result: (rows, columns) => `Ready table: ${rows} rows · ${columns} columns`,
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
    notNumbers:
      "This calculation relies on a column that contains values that aren't numbers, so it was stopped rather than show a wrong result. The data preparation report shows which column.",
    followUp: (question) => `You can ask a follow-up — previous: “${question}”`,
    newTopic: "New topic",
  },
  result: {
    region: "Result",
    empty: "No records match this question.",
    insight: "Insight",
    note: "Note",
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
    viewGroup: "View",
    views: { metric: "Summary", bar: "Bar", line: "Line", pie: "Pie", table: "Table" },
    page: (n, total) => `Page ${n} of ${total}`,
    pngPages: (n) => `Download the table as ${n} PNG images`,
    slices: "Slices",
  },
  suggestions: {
    total: (measure) => (hasTotalWord(measure) ? measure : `total ${measure}`),
    top: (total, dim) => `Which ${dim} has the highest ${total}?`,
    trend: (total) => `How did ${total} change month by month?`,
    share: (total, dim) => `How is ${total} split by ${dim}?`,
    countTop: (dim) => `Which ${dim} appears most often?`,
    countTrend: "How did the number of records change month by month?",
    countShare: (dim) => `How are the records split by ${dim}?`,
  },
  insight: {
    other: "Other",
    empty: "No records match this question.",
    noNumbers: "No numeric values to show.",
    tablePartial: (n) =>
      `The result is very large; showing the first ${n} rows. Charts and totals are hidden because partial data would make them wrong — try narrowing or grouping the question.`,
    tableTruncated: (n) => `The result has more than ${n} rows; showing the first ${n}.`,
    tableRows: (n) => `Found ${n} rows.`,
    tableTotal: (label, rows, value) =>
      `${hasTotalWord(label) ? label : `Total ${label.toLocaleLowerCase("en")}`} (${rows} listed rows): ${value}`,
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

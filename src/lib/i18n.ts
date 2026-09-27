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
    verify: (page: number, pages: number) => `Taranmış sayılar ikinci kez kontrol ediliyor: sayfa ${page}/${pages}`,
    drop: "CSV, Excel veya PDF dosyanı buraya bırak",
    orClick: "ya da seçmek için tıkla",
    privacy: "Dosya hiçbir sunucuya yüklenmez",
    sample: "Örnek satış verisiyle dene",
    urlLabel: "ya da bir bağlantıdan aç",
    urlPlaceholder: "Google Sheets veya GitHub dosya bağlantısı",
    urlOpen: "Aç",
    urlHint: "Dosya doğrudan tarayıcına indirilir; Insitu sunucusundan geçmez. Google Sheets tablosu “bağlantıya sahip herkes görüntüleyebilir” olmalı.",
    urlLoading: "Bağlantıdaki dosya tarayıcına indiriliyor…",
  },
  file: {
    unsupported: "Şimdilik yalnızca CSV, Excel ve PDF dosyaları destekleniyor.",
    sampleFailed: "Örnek veri yüklenemedi; bağlantını kontrol edip tekrar dene.",
    readFailed: (detail: string) => `Dosya okunamadı: ${detail}`,
    codes: {
      "no-sheet": "Excel dosyasında sayfa bulunamadı.",
      "no-columns": "Dosyada sütun bulunamadı.",
      "url-invalid": "Bağlantı geçerli değil; https:// ile başlayan tam bağlantıyı yapıştır.",
      "url-unsupported": "Bu bağlantı desteklenmiyor. Google Sheets tablosu veya GitHub'daki bir CSV/Excel/PDF dosyasının bağlantısını kullan.",
      "url-private": "Tablo herkese açık değil. Google Sheets'te Paylaş → “Bağlantıya sahip olan herkes” → Görüntüleyen yap ve tekrar dene.",
      "url-failed": "Bağlantıdaki dosya indirilemedi; bağlantıyı ve internetini kontrol et.",
      "url-too-large": "Bağlantıdaki dosya çok büyük (en fazla 200 MB).",
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
  offline: {
    banner:
      "İnternet bağlantın yok. Dosya açma, hesaplama, kayıtlı soruları geri yükleme, SQL'i elle çalıştırma ve indirmeler çalışır; yeni bir soruyu çevirmek için bağlantı gerekir.",
  },
  share: {
    button: "Paylaş",
    buttonHint: "Bu oturumdaki soruları ve sorguları bir bağlantıyla paylaş (veri eklenmez)",
    copied: "Bağlantı panoya kopyalandı.",
    copyManually: "Bağlantıyı kopyala:",
    copy: "Kopyala",
    explain: "Bağlantıda yalnızca sorular ve sorgular var; veri yok. Alan kişi kendi dosyasını yükleyince analizler onun tarayıcısında çalışır.",
    incoming: (n: number) => `Bu bağlantı ${n} analiz içeriyor. Kendi dosyanı yükle; analizler senin dosyanda, tarayıcında çalıştırılır. Bağlantıda veri yoktur.`,
    offer: (n: number) => `Bağlantıdaki ${n} analizi bu dosyada çalıştırabilirsin.`,
    run: "Çalıştır",
    allRan: (n: number) => `Bağlantıdaki ${n} analiz bu dosyada çalıştırıldı.`,
    someFailed: (ran: number, failed: number) =>
      `${ran} analiz çalıştırıldı; ${failed} analiz bu dosyada çalışmadı (sütunları farklı olabilir).`,
    noneRan: (n: number) => `Bağlantıdaki ${n} analiz bu dosyada çalışmadı; bağlantı başka sütunları olan bir dosya için hazırlanmış olabilir.`,
    invalid: "Paylaşım bağlantısı okunamadı; bozuk veya eksik kopyalanmış olabilir.",
    tooLarge: "Paylaşım bağlantısı oluşturulamadı.",
    dismiss: "Kapat",
  },
  report: {
    add: "Rapora ekle",
    added: "Raporda",
    addHint: "Bu analizi seçili görünümüyle PDF rapora ekler",
    summary: (n: number) => `Rapor: ${n} analiz`,
    working: (done: number, total: number) => `Rapor hazırlanıyor… ${done}/${total}`,
    failed: "Rapor oluşturulamadı; tekrar dene.",
    download: "PDF indir",
    clear: "Raporu temizle",
    remove: (title: string) => `“${title}” analizini rapordan çıkar`,
    coverTitle: "Insitu raporu",
    coverSubtitle: (file: string, date: string, n: number) => `${file} · ${date} · ${n} analiz`,
    contents: "İçindekiler",
    footer: "Insitu · Veriler bu cihazda işlendi; hiçbir satır bir sunucuya gönderilmedi.",
    page: (n: number, total: number) => `Sayfa ${n} / ${total}`,
    continued: "(devam)",
    pageRef: (n: number) => `s. ${n}`,
    fileName: (base: string) => `insitu-rapor-${base}`,
  },
  overview: {
    title: "İlk bakış",
    subtitle: "Dosyan açılır açılmaz tarayıcında, gerçek verinden hesaplandı. Bir bulguya tıklayınca grafiğini görürsün.",
    warningCount: (n: number) => `${n} uyarı`,
    warningsTitle: "Dikkat edilmesi gerekenler",
    total: (rows: string) => `${rows} kayıt`,
    totalWith: (rows: string, measure: string, total: string) => `${rows} kayıt · toplam ${measure}: ${total}`,
    top: (dim: string, value: string, share: string, amount: string) => `${capitalize(dim, "tr")} bazında en büyük pay: ${value} — ${share} (${amount})`,
    bestMonth: (month: string, amount: string) => `En yüksek ay: ${month} (${amount})`,
    trend: (from: string, to: string, change: string) => `${from} → ${to}: ${change} (yalnızca tam aylar karşılaştırıldı)`,
    status: (value: string, share: string, rows: string) => `Kayıtların ${share} kadarı “${value}” (${rows} kayıt)`,
    outliers: (measure: string, count: string, max: string, median: string) =>
      `${capitalize(measure, "tr")}: ${count} kayıtta olağandışı yüksek değer var (en büyüğü ${max}; tipik değer ${median}).`,
    monthSpike: (month: string, high: boolean, amount: string, median: string) =>
      `${month} olağandışı ${high ? "yüksek" : "düşük"}: ${amount} (tipik bir ay ${median}).`,
    negatives: (measure: string, count: string) =>
      `${capitalize(measure, "tr")}: ${count} kayıtta negatif değer var (iade veya düzeltme olabilir); toplamlara dahildir.`,
    duplicates: (count: string) => `${count} satır, başka bir satırın birebir aynısı. Gerçek bir tekrar mı yoksa çift kayıt mı, kontrol et.`,
    askTotal: (total: string) => `${total} ne kadar?`,
    askCount: "Toplam kaç kayıt var?",
    askTop: (measure: string) => `En yüksek ${measure} değerine sahip 10 kaydı göster`,
    askNegatives: (measure: string) => `${measure} değeri negatif olan kayıtları göster`,
    askDuplicates: "Birebir tekrar eden kayıtları ve kaç kez tekrarlandıklarını göster",
    askHint: (question: string) => `Sor: “${question}”`,
  },
  session: {
    offer: (n: number) => `Bu dosyada daha önce sorduğun ${n} soru var. Cevaplar dosyandan yeniden hesaplanır.`,
    restore: "Geri yükle",
    restoring: "Hesaplanıyor…",
    dismiss: "Yok say",
  },
  history: {
    title: "Önceki cevaplar",
    count: (n: number) => `${n} cevap`,
    show: "Bu cevabı göster",
  },
  prep: {
    title: "Veri hazırlama raporu ve önizleme",
    previewTitle: (n: number) => `Temizlenmiş verinin ilk ${n} satırı`,
    profileTitle: "Sütun özeti (tarayıcında hesaplandı)",
    profileCols: { column: "Sütun", type: "Tür", filled: "Dolu", distinct: "Farklı değer", values: "Aralık / en sık değerler" },
    types: { number: "Sayı", text: "Metin", date: "Tarih" },
    range: (lo: string, hi: string) => `${lo} – ${hi}`,
    topValue: (value: string, count: string) => `${value} (${count})`,
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
    ocrChecked: (checked: number, corrected: number) =>
      `Taranmış ${checked} sayı/tarih iki farklı okumayla karşılaştırıldı${corrected > 0 ? `; ${corrected} tanesi, rakam modunda yapılan ek okumaların çoğunluğuyla düzeltildi` : ""}`,
    ocrUncertain: (n: number) =>
      `${n} değer okumalar uyuşmadığı için “(?)” ile işaretlendi; bu değerlerin sütunuyla hesap yapılmaz. Orijinal PDF'e bakıp düzeltilmiş bir kopya yükleyebilirsin.`,
    mergedCells: (n: number) => `Birleştirilmiş hücreler açıldı: ${n} boş hücre, birleştirilen değerle dolduruldu`,
    hiddenRows: (n: number) => `Excel'de gizlenmiş veya filtrelenmiş ${n} satır da dahil edildi (Excel'in TOPLA işlevi gibi)`,
    pageFurniture: (n: number) => `${n} sayfa üst/alt bilgisi satırı (sayfa numarası, rapor başlığı) atıldı`,
    repeatedHeaders: (n: number) => `Her sayfada tekrarlanan ${n} başlık satırı atıldı`,
    wrappedRows: (n: number) => `Alt satıra taşan ${n} hücre metni üstündeki satırla birleştirildi`,
    ambiguous: (column: string) =>
      `${column}: “1,250” gibi değerler hem 1,25 hem 1.250 olabilir; yanlış sayı üretmemek için sütun metin olarak bırakıldı. Dosyada ondalık ve binlik ayraçlarını netleştirip tekrar yükleyebilirsin.`,
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
    followUps: "Devam soruları",
    computing: "Hesaplanıyor",
    translateFailed: "Soru şu an çevrilemedi, lütfen tekrar dene.",
    computeFailed: "Bu soru hesaplanamadı. Soruyu biraz farklı sözcüklerle tekrar sormayı dene.",
    timeout: "Yanıt çok uzun sürdü; yapay zekâ şu an yoğun olabilir. Birazdan tekrar dene.",
    retry: "Tekrar dene",
    offline: "İnternet bağlantın yok; soruyu çevirmek için bağlantı gerekiyor. Bu arada kayıtlı soruları geri yükleyebilir veya SQL'i elle çalıştırabilirsin.",
    queryTimeout: "Bu hesap çok uzun sürdüğü için durduruldu (1 dakika). Soruyu daraltmayı dene, örneğin bir tarih aralığı veya ilk 10 sonuç.",
    cancel: "Vazgeç",
    technical: "Teknik ayrıntı",
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
    tableFallback:
      "Bu sonuç seçilen grafiğe uygun olmadığı için (ör. 30'dan fazla kategori, 8'den fazla seri veya sayısal olmayan değerler) tablo olarak gösteriliyor.",
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
    sortBy: "sıralamak için tıkla",
    editSql: "SQL'i düzenle",
    drill: (label: string) => `"${label}" için ayrıntıya in`,
    editHint: "Sorguyu düzenleyip bu dosya üzerinde yeniden çalıştırabilirsin. Yalnızca okuma sorguları (SELECT) çalışır; yapay zekâya bir şey gönderilmez.",
    runSql: "Çalıştır",
    sqlFailed: "Düzenlenen sorgu çalıştırılamadı. Teknik ayrıntıya bakıp düzelterek tekrar dene.",
    editedMark: "SQL elle düzenlendi",
    yes: "Evet",
    no: "Hayır",
    // File-name suffix when an export stops at the row cap.
    firstRowsSuffix: (n: number) => `-ilk-${n}`,
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
    // After an answer: short follow-ups that rely on the conversation context.
    followMonthly: "Bunu aylara göre göster",
    followTop: "Sadece ilk 5'i göster",
    followBy: (dim: string) => `Bunu ${dim} bazında göster`,
    drill: (label: string) => `Bunu sadece "${label}" için ayrıntılı göster`,
  },
  insight: {
    other: "Diğer",
    empty: "Bu soruya uyan kayıt bulunamadı.",
    noNumbers: "Gösterilecek sayısal değer bulunamadı.",
    tablePartial: (n: number) =>
      `Sonuç çok büyük; ilk ${n} satır gösteriliyor. Grafik ve toplamlar kısmi veriyle yanlış olacağından gösterilmiyor — soruyu daraltmayı veya gruplamayı dene.`,
    tableTruncated: (n: number) => `Sonuç ${n}'den fazla satır içeriyor; ilk ${n} satır gösteriliyor.`,
    tableRows: (n: string) => `${n} satırlık sonuç bulundu.`,
    // No "Toplam" prefix when the label already says it ("Toplam Ciro", "Satış Toplamı"). The label
    // is kept as written: lower-casing it would also lower-case names ("İstanbul Cirosu").
    tableTotal: (label: string, rows: string, value: string) =>
      `${hasTotalWord(label) ? label : `Toplam ${label}`} (${rows} satır): ${value}`,
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
    partialStart: (month: string, firstDay: string) => ` ${month} verisi tam değil (ilk gün: ${firstDay}), karşılaştırmaya alınmadı.`,
    partialEnd: (month: string, lastDay: string) => ` ${month} henüz tamamlanmamış (son gün: ${lastDay}), karşılaştırmaya alınmadı.`,
    incomplete: (lastX: string, lastV: string, endX: string) =>
      ` Son dönem (${lastX}: ${lastV}) diğerlerinden belirgin düşük; dönem henüz tamamlanmamış olabilir, bu yüzden karşılaştırma ${endX} ile yapıldı.`,
  },
  server: {
    rateLimited: (seconds: number) => `Çok fazla soru gönderildi. Lütfen ${seconds} saniye sonra tekrar dene.`,
    dailyLimit: "Sitenin bugünkü soru kotası doldu. Yarın tekrar deneyebilirsin; kendi kopyanı kurmak için README'ye bak.",
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
    verify: (page, pages) => `Double-checking scanned numbers: page ${page}/${pages}`,
    drop: "Drop your CSV, Excel or PDF file here",
    orClick: "or click to choose",
    privacy: "Your file is never uploaded to a server",
    sample: "Try it with sample sales data",
    urlLabel: "or open from a link",
    urlPlaceholder: "Google Sheets or GitHub file link",
    urlOpen: "Open",
    urlHint: "The file downloads straight into your browser, not through Insitu's server. A Google Sheet must be shared as “anyone with the link can view”.",
    urlLoading: "Downloading the linked file into your browser…",
  },
  file: {
    unsupported: "Only CSV, Excel and PDF files are supported for now.",
    sampleFailed: "The sample data couldn't be loaded; check your connection and try again.",
    readFailed: (detail) => `Couldn't read the file: ${detail}`,
    codes: {
      "no-sheet": "No sheet found in the Excel file.",
      "no-columns": "No columns found in the file.",
      "url-invalid": "That link isn't valid; paste the full link starting with https://.",
      "url-unsupported": "This link isn't supported. Use a Google Sheets link or a link to a CSV/Excel/PDF file on GitHub.",
      "url-private": "The sheet isn't public. In Google Sheets choose Share → “Anyone with the link” → Viewer, then try again.",
      "url-failed": "The linked file couldn't be downloaded; check the link and your connection.",
      "url-too-large": "The linked file is too large (200 MB at most).",
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
  offline: {
    banner:
      "You're offline. Opening files, computing, restoring saved questions, running SQL by hand and downloads all work; translating a new question needs a connection.",
  },
  share: {
    button: "Share",
    buttonHint: "Share this session's questions and queries as a link (no data included)",
    copied: "Link copied to the clipboard.",
    copyManually: "Copy the link:",
    copy: "Copy",
    explain: "The link contains only questions and queries, no data. The recipient loads their own file and the analyses run in their browser.",
    incoming: (n) => `This link contains ${n} analys${n === 1 ? "is" : "es"}. Load your own file; they run on it, in your browser. The link contains no data.`,
    offer: (n) => `You can run the ${n} analys${n === 1 ? "is" : "es"} from the link on this file.`,
    run: "Run",
    allRan: (n) => `The ${n} analys${n === 1 ? "is" : "es"} from the link ran on this file.`,
    someFailed: (ran, failed) => `${ran} ran; ${failed} couldn't run on this file (its columns may differ).`,
    noneRan: (n) => `The ${n} analys${n === 1 ? "is" : "es"} from the link couldn't run on this file; the link may be for a file with other columns.`,
    invalid: "The share link couldn't be read; it may be damaged or incompletely copied.",
    tooLarge: "The share link couldn't be created.",
    dismiss: "Close",
  },
  report: {
    add: "Add to report",
    added: "In report",
    addHint: "Adds this analysis, in the view shown, to the PDF report",
    summary: (n) => `Report: ${n} analys${n === 1 ? "is" : "es"}`,
    working: (done, total) => `Preparing the report… ${done}/${total}`,
    failed: "The report couldn't be created; try again.",
    download: "Download PDF",
    clear: "Clear report",
    remove: (title) => `Remove “${title}” from the report`,
    coverTitle: "Insitu report",
    coverSubtitle: (file, date, n) => `${file} · ${date} · ${n} analys${n === 1 ? "is" : "es"}`,
    contents: "Contents",
    footer: "Insitu · Data processed on this device; no row was sent to a server.",
    page: (n, total) => `Page ${n} / ${total}`,
    continued: "(continued)",
    pageRef: (n) => `p. ${n}`,
    fileName: (base) => `insitu-report-${base}`,
  },
  overview: {
    title: "First look",
    subtitle: "Computed in your browser from your real data as soon as the file opened. Click a finding to see its chart.",
    warningCount: (n) => `${n} warning${n === 1 ? "" : "s"}`,
    warningsTitle: "Worth checking",
    total: (rows) => `${rows} records`,
    totalWith: (rows, measure, total) => `${rows} records · total ${measure}: ${total}`,
    top: (dim, value, share, amount) => `Largest share by ${dim}: ${value} — ${share} (${amount})`,
    bestMonth: (month, amount) => `Best month: ${month} (${amount})`,
    trend: (from, to, change) => `${from} → ${to}: ${change} (complete months only)`,
    status: (value, share, rows) => `${share} of the records are “${value}” (${rows} records)`,
    outliers: (measure, count, max, median) =>
      `${capitalize(measure, "en")}: unusually high values in ${count} record${count === "1" ? "" : "s"} (largest ${max}; typical ${median}).`,
    monthSpike: (month, high, amount, median) => `${month} is unusually ${high ? "high" : "low"}: ${amount} (a typical month is ${median}).`,
    negatives: (measure, count) => `${capitalize(measure, "en")}: ${count} record${count === "1" ? "" : "s"} with a negative value (returns or corrections?); included in totals.`,
    duplicates: (count) => `${count} row${count === "1" ? " is an exact copy" : "s are exact copies"} of another row. Check whether that is real or a double entry.`,
    askTotal: (total) => `What is the ${total}?`,
    askCount: "How many records are there?",
    askTop: (measure) => `Show the 10 records with the highest ${measure}`,
    askNegatives: (measure) => `Show the records with a negative ${measure}`,
    askDuplicates: "Show the rows that appear more than once and how many times",
    askHint: (question) => `Ask: “${question}”`,
  },
  session: {
    offer: (n) => `You asked ${n} question${n === 1 ? "" : "s"} about this file before. Answers are recomputed from your file.`,
    restore: "Restore",
    restoring: "Computing…",
    dismiss: "Ignore",
  },
  history: {
    title: "Earlier answers",
    count: (n) => `${n} answer${n === 1 ? "" : "s"}`,
    show: "Show this answer",
  },
  prep: {
    title: "Data preparation report & preview",
    previewTitle: (n) => `First ${n} rows of the cleaned data`,
    profileTitle: "Column summary (computed in your browser)",
    profileCols: { column: "Column", type: "Type", filled: "Filled", distinct: "Distinct", values: "Range / most frequent values" },
    types: { number: "Number", text: "Text", date: "Date" },
    range: (lo, hi) => `${lo} – ${hi}`,
    topValue: (value, count) => `${value} (${count})`,
    csvSource: (encoding, delimiter) => `CSV · ${encoding} encoding · delimiter: ${delimiter}`,
    excelSource: (sheet) => `Excel · sheet “${sheet}”`,
    pdfSource: (pages, from, to) => `PDF · ${pages} page${pages === 1 ? "" : "s"} · table on ${from === to ? `page ${from}` : `pages ${from}–${to}`}`,
    ocrPages: (n) => `${n} scanned page${n === 1 ? "" : "s"} read in the browser with text recognition (OCR)`,
    ocrWarning: (n) =>
      n > 0
        ? `Text recognition was unsure about ${n} word${n === 1 ? "" : "s"}; compare the preview with the original PDF`
        : "Compare the text recognition results in the preview with the original PDF",
    ocrSkipped: (n) => `${n} scanned page${n === 1 ? "" : "s"} over the limit ${n === 1 ? "was" : "were"} not read`,
    ocrChecked: (checked, corrected) =>
      `${checked} scanned numbers/dates cross-checked with two independent readings${corrected > 0 ? `; ${corrected} fixed by a majority of extra digits-only readings` : ""}`,
    ocrUncertain: (n) =>
      `${n} value${n === 1 ? "" : "s"} marked “(?)” because the readings disagreed; no calculation uses ${n === 1 ? "its" : "their"} column. Check the original PDF and upload a corrected copy.`,
    mergedCells: (n) => `Merged cells unmerged: ${n} empty cell${n === 1 ? "" : "s"} filled with the merged value`,
    hiddenRows: (n) => `${n} row${n === 1 ? "" : "s"} hidden or filtered out in Excel ${n === 1 ? "is" : "are"} included (as Excel's SUM does)`,
    pageFurniture: (n) => `${n} page header/footer line${n === 1 ? "" : "s"} (page numbers, report titles) removed`,
    repeatedHeaders: (n) => `${n} header row${n === 1 ? "" : "s"} repeated on each page removed`,
    wrappedRows: (n) => `${n} cell${n === 1 ? "" : "s"} wrapped onto the next line joined with the row above`,
    ambiguous: (column) =>
      `${column}: values like “1,250” could mean 1.25 or 1,250, so the column was kept as text rather than guessed. Make the decimal and thousands separators unambiguous in the file and upload it again.`,
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
    followUps: "Follow-up questions",
    computing: "Computing",
    translateFailed: "Couldn't translate the question right now, please try again.",
    computeFailed: "This question couldn't be computed. Try asking it in slightly different words.",
    timeout: "The answer took too long; the AI may be busy right now. Try again in a moment.",
    retry: "Try again",
    offline: "You're offline; translating the question needs a connection. Meanwhile you can restore saved questions or run SQL by hand.",
    queryTimeout: "This calculation took too long and was stopped (1 minute). Try narrowing the question, e.g. a date range or the top 10.",
    cancel: "Cancel",
    technical: "Technical details",
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
    tableFallback:
      "This result doesn't fit the chosen chart (e.g. more than 30 categories, more than 8 series or non-numeric values), so it is shown as a table.",
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
    sortBy: "click to sort",
    editSql: "Edit SQL",
    drill: (label) => `Drill into "${label}"`,
    editHint: "Edit the query and run it again on this file. Only read queries (SELECT) run; nothing is sent to the AI.",
    runSql: "Run",
    sqlFailed: "The edited query couldn't run. Check the technical details, fix it and try again.",
    editedMark: "SQL edited by hand",
    yes: "Yes",
    no: "No",
    firstRowsSuffix: (n) => `-first-${n}`,
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
    followMonthly: "Show this by month",
    followTop: "Show only the top 5",
    followBy: (dim) => `Show this by ${dim}`,
    drill: (label) => `Show the details for "${label}" only`,
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
      `${hasTotalWord(label) ? label : `Total ${label}`} (${rows} rows): ${value}`,
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
    partialStart: (month, firstDay) => ` ${month} is only partly covered (first day: ${firstDay}) and is not compared.`,
    partialEnd: (month, lastDay) => ` ${month} is not complete yet (last day: ${lastDay}) and is not compared.`,
    incomplete: (lastX, lastV, endX) =>
      ` The last period (${lastX}: ${lastV}) is far below the others and may be incomplete, so the comparison uses ${endX}.`,
  },
  server: {
    rateLimited: (seconds) => `Too many questions. Please try again in ${seconds} seconds.`,
    dailyLimit: "This site's question quota for today is used up. Try again tomorrow, or see the README to run your own copy.",
    invalid: "Invalid request.",
    quota: "The AI usage quota is exhausted. Please try again in about a minute.",
    unavailable: "The AI couldn't respond right now, please try again shortly.",
    notAnswerable: "This question can't be answered with the available columns.",
    unreliable: "Couldn't turn the question into a reliable query; try rephrasing it.",
  },
}

export const messages: Record<Locale, Messages> = { tr, en }

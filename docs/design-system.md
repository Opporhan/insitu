# Insitu Design System

`ui-ux-pro-max` skill'inin aramalarından derlendi (`--domain style`: Exaggerated Minimalism, Bento Box Grid, Dark Mode (OLED); `--domain chart`; `--stack shadcn`).
Otomatik `--design-system` önerisi (açık zemin, "Vibrant & Block-based") manifestoyla çeliştiği için reddedildi; yalnızca tipografi önerisi (Fira ailesi → "dashboard, data, analytics") yerine Geist Sans/Mono ile aynı teknik his korundu.

## Stil = Minimalism + Bento Grid + Dark Mode
| Kaynak stil | Aldığımız |
|---|---|
| Minimalism | Tek vurgu rengi (zümrüt), geniş boşluk, büyük başlık, süs yok |
| Bento Box Grid | Sonuç ekranı modüler kartlar: büyük grafik kartı (2 sütun) + içgörü + nasıl hesapladım + indir; `rounded-xl`, ince kenarlık |
| Dark Mode (OLED) | Neredeyse siyah zemin, düşük beyaz yayılım, görünür focus halkası |

## Renk token'ları (`src/app/globals.css`)
| Rol | Hex |
|---|---|
| Zemin | `#0A0A0B` |
| Kart | `#111113` |
| Kenarlık | `#232326` |
| Metin | `#EDEDEF` |
| İkincil metin | `#A1A1AA` (zemin üzerinde ≥ 4.5:1) |
| Vurgu / chart-1 (zümrüt) | `#10B981` |
| chart-2 (gece mavisi açık) | `#3B82F6` |
| chart-3 | `#34D399` |
| chart-4 | `#1E40AF` |
| chart-5 | `#6EE7B7` |
| Hata | `#F87171` |

### Aydınlık tema
| Rol | Hex |
|---|---|
| Zemin | `#FAFAFA` |
| Kart | `#FFFFFF` |
| Kenarlık | `#E4E4E7` |
| Metin | `#0A0A0B` |
| İkincil metin | `#52525B` (7,4:1) |
| Vurgu (zümrüt) | `#047857` (kart üzerinde 5,5:1) |
| chart-1…8 | `#059669` `#2563EB` `#10B981` `#1E3A8A` `#34D399` `#0D9488` `#6366F1` `#64748B` |

Karanlık tema varsayılandır; başlıktaki düğmeyle değişir ve tercih hatırlanır.

## Tipografi
- Geist Sans (gövde, 16px, line-height 1.6), Geist Mono (SQL, sayılar).
- Başlık `tracking-tight`, satır uzunluğu ≤ 70ch.

## Grafik kuralları (`--domain chart`)
- Kategori karşılaştırma / sıralama → **Bar**, azalan sıralı, değer etiketleri.
- Zaman içinde trend → **Line**, dolgu %20 opaklık.
- Parça-bütün → **Pie/Donut**, en fazla 7 dilim (fazlası "Diğer").
- Recharts her zaman shadcn `ChartContainer` + `chartConfig` ile; renkler inline değil `var(--chart-n)`.

## UX kontrol listesi (CRITICAL/HIGH)
- Kontrast ≥ 4.5:1, görünür focus halkası, ikon butonlarda `aria-label`.
- Dokunma hedefi ≥ 44px, tıklanabilirde `cursor-pointer`.
- Async sırasında buton devre dışı + yükleme durumu; hata mesajı sorunun yanında.
- Geçişler 150–300ms, yalnızca transform/opacity; `prefers-reduced-motion` saygısı.
- Emoji ikon yok → Lucide SVG.
- 375 / 768 / 1024 / 1440px'te yatay kaydırma yok.

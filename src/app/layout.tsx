import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/components/i18n-provider";
import { LOCALE_COOKIE, localeFromAcceptLanguage, messages, parseLocale, type Locale } from "@/lib/i18n";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

/** Cookie choice first; on a first visit, the browser's preferred language. */
async function currentLocale(): Promise<Locale> {
  const fromCookie = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return fromCookie ?? localeFromAcceptLanguage((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = messages[await currentLocale()];
  return { title: meta.title, description: meta.description };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await currentLocale();
  return (
    <html
      lang={locale}
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The init script may flip the theme class before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}

"use client"

import { Moon, Sun } from "lucide-react"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { THEME_STORAGE_KEY } from "@/lib/theme"

export function ThemeToggle() {
  const { t } = useI18n()
  function toggle() {
    const dark = document.documentElement.classList.toggle("dark")
    try {
      localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light")
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  }

  // Icons switch via the `dark:` variant, so server and client render the same markup.
  return (
    <Button variant="ghost" size="icon-lg" className="size-11" aria-label={t.header.theme} onClick={toggle}>
      <Sun className="hidden dark:block" aria-hidden />
      <Moon className="dark:hidden" aria-hidden />
    </Button>
  )
}

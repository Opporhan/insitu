export const THEME_STORAGE_KEY = "insitu-theme"

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme.
 * Dark is the default; only an explicit "light" choice switches it.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{d.classList.toggle("dark",localStorage.getItem("${THEME_STORAGE_KEY}")!=="light")}catch(e){d.classList.add("dark")}})()`

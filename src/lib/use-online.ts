"use client"

import { useSyncExternalStore } from "react"

/** Whether the browser reports a connection (files and computing work offline; asking needs it). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange)
      window.addEventListener("offline", onChange)
      return () => {
        window.removeEventListener("online", onChange)
        window.removeEventListener("offline", onChange)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

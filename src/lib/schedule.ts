/** Rows processed between yields; small enough that no chunk becomes a >50 ms long task. */
export const CHUNK_ROWS = 5_000

type Scheduler = { yield?: () => Promise<void> }

/** Lets the browser paint and handle input before continuing a long loop. */
export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Scheduler }).scheduler
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0))
}

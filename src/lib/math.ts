/**
 * Neumaier-compensated sum: avoids the drift of naive float addition
 * (e.g. 0.1 + 0.2 + … over thousands of rows) so totals match the data exactly.
 */
export function preciseSum(values: Iterable<number>): number {
  let sum = 0
  let compensation = 0
  for (const v of values) {
    const t = sum + v
    compensation += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum
    sum = t
  }
  return sum + compensation
}

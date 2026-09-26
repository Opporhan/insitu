export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1254"

/**
 * Bytes → text without mangling Turkish characters. BOMs decide first; valid UTF-8 is
 * taken as UTF-8; BOM-less UTF-16 is recognized by its zero bytes (Excel "Unicode text");
 * anything else is Windows-1254, the encoding of Turkish Excel's "CSV" export.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" }

  const sample = bytes.subarray(0, 4096)
  let oddZeros = 0
  let evenZeros = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue
    if (i % 2) oddZeros++
    else evenZeros++
  }
  const half = sample.length / 2
  if (half > 0 && oddZeros / half > 0.3 && evenZeros / half < 0.05) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" }
  if (half > 0 && evenZeros / half > 0.3 && oddZeros / half < 0.05) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" }

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("windows-1254").decode(bytes), encoding: "windows-1254" }
  }
}

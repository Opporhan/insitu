import { describe, expect, it } from "vitest"
import { prepareBytes } from "@/lib/engine/prepare"

const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe("prepareBytes", () => {
  it("passes UTF-8 through and strips the BOM", async () => {
    const file = new File([new Uint8Array([0xef, 0xbb, 0xbf]), "şehir\nİzmir\n"], "a.csv")
    expect(text(await prepareBytes(file))).toBe("şehir\nİzmir\n")
  })

  it("re-encodes Windows-1254 (Turkish Excel CSV) to UTF-8", async () => {
    // "Şişli;Ğ" in Windows-1254
    const file = new File([new Uint8Array([0xde, 0x69, 0xfe, 0x6c, 0x69, 0x3b, 0xd0])], "b.csv")
    expect(text(await prepareBytes(file))).toBe("Şişli;Ğ")
  })
})

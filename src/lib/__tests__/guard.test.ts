import { describe, expect, it } from "vitest"
import { guardSql } from "@/lib/engine/guard"

describe("guardSql", () => {
  it.each([
    "SELECT label, value FROM data",
    "WITH a AS (SELECT 1 AS x) SELECT x FROM a;",
    `SELECT "update_date" AS label, 1 AS value FROM data`,
  ])("accepts %s", (sql) => {
    expect(guardSql(sql).ok).toBe(true)
  })

  it.each([
    "DROP TABLE data",
    "SELECT 1; DROP TABLE data",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM data -- hidden",
    "ATTACH 'x.db'",
    "COPY data TO 'out.csv'",
    "INSTALL httpfs",
    "SET enable_external_access = true",
    "SELECT * FROM glob('*')",
  ])("rejects %s", (sql) => {
    expect(guardSql(sql).ok).toBe(false)
  })
})

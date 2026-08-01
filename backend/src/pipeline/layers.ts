import { readFile } from "node:fs/promises";
import path from "node:path";
import { executeClickHouse } from "./clickhouse.js";

/**
 * Local Docker mounts infra/clickhouse/init/*.sql on first boot.
 * ClickHouse Cloud does not — so cloud setup/runs must create layers explicitly.
 */
export async function ensurePipelineLayers(repoRoot: string) {
  const sqlPath = path.join(
    repoRoot,
    "infra",
    "clickhouse",
    "init",
    "01_layers.sql",
  );
  const sql = await readFile(sqlPath, "utf8");
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    await executeClickHouse(statement);
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("--")) return "";
          return line;
        })
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

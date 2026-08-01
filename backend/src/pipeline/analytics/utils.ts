import { queryClickHouseText, sqlString } from "../clickhouse.js";

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function normalizeTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length > 1),
  );
}

export function scoreAgainstTerms(
  terms: Set<string>,
  ...values: Array<string | string[] | null | undefined>
) {
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }
      return [value ?? ""];
    })
    .flatMap((value) => Array.from(normalizeTokens(value)))
    .reduce((score, token) => score + (terms.has(token) ? 1 : 0), 0);
}

export function compactJson(value: unknown, maxLength = 12000) {
  const json = JSON.stringify(value, null, 2);
  return json.length > maxLength
    ? `${json.slice(0, maxLength)}\n...truncated...`
    : json;
}

export async function getKnownClickHouseTables(): Promise<string[]> {
  const raw = await queryClickHouseText(`
SELECT concat(database, '.', name) AS table_name
FROM system.tables
WHERE database IN ('silver', 'gold', 'context')
ORDER BY database, name
FORMAT TabSeparated
`);
  return raw.trim() ? raw.trim().split("\n") : [];
}

export async function getClickHouseColumns(
  tables: string[],
): Promise<Array<{ table_name: string; column_name: string; type: string }>> {
  if (tables.length === 0) {
    return [];
  }
  const tableNames = tables.map((table) => {
    const [, name = table] = table.split(".");
    return sqlString(name);
  });
  const raw = await queryClickHouseText(`
SELECT concat(database, '.', table) AS table_name, name AS column_name, type
FROM system.columns
WHERE database IN ('silver', 'gold', 'context')
  AND table IN (${tableNames.join(", ")})
ORDER BY database, table, position
FORMAT TabSeparated
`);
  return raw.trim()
    ? raw
        .trim()
        .split("\n")
        .map((line) => {
          const [table_name, column_name, type] = line.split("\t");
          return { table_name, column_name, type };
        })
    : [];
}

export function stripSqlFormatting(sql: string) {
  return sql
    .replace(/```sql/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/;+\s*$/g, "");
}

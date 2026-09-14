export type ClipboardRowFormat = "plain" | "json" | "html" | "markdown" | "csv" | "csvWithHeader" | "insert";

export type ClipboardRowInput = {
  columns: string[];
  row: Record<string, unknown>;
  schema?: string;
  table?: string;
};

export type ClipboardRowsInput = {
  columns: string[];
  rows: Record<string, unknown>[];
  schema?: string;
  table?: string;
};

export function formatCell(value: unknown): string {
  if (value === null) {
    return "NULL";
  }

  if (value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function parseCellInput(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed.toLowerCase() === "null") {
    return null;
  }

  if (trimmed === "") {
    return "";
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0]);
  return toCsvRows(rows, columns, true);
}

export function formatRowForClipboard(format: ClipboardRowFormat, input: ClipboardRowInput): string {
  return formatRowsForClipboard(format, {
    columns: input.columns,
    rows: [input.row],
    schema: input.schema,
    table: input.table
  });
}

export function formatRowsForClipboard(format: ClipboardRowFormat, input: ClipboardRowsInput): string {
  const rows = input.rows.map((row) => orderRow(row, input.columns));

  switch (format) {
    case "plain":
      return rows
        .map((row) => input.columns.map((column) => `${column}: ${formatCell(row[column])}`).join("\n"))
        .join("\n\n");
    case "json":
      return JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2);
    case "html":
      return toHtmlTable(rows, input.columns);
    case "markdown":
      return toMarkdownTable(rows, input.columns);
    case "csv":
      return toCsvRows(rows, input.columns, false);
    case "csvWithHeader":
      return toCsvRows(rows, input.columns, true);
    case "insert":
      return toInsertStatement(rows, input.columns, input.schema, input.table);
  }
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function orderRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

function toCsvRows(rows: Record<string, unknown>[], columns: string[], includeHeader: boolean): string {
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(","));
  return [...(includeHeader ? [columns.join(",")] : []), ...body].join("\n");
}

function escapeCsvCell(value: unknown): string {
  const text = formatCell(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toHtmlTable(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows
    .map((row) => `    <tr>${columns.map((column) => `<td>${escapeHtml(formatCell(row[column]))}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n  <thead>\n    <tr>${header}</tr>\n  </thead>\n  <tbody>\n${body}\n  </tbody>\n</table>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toMarkdownTable(rows: Record<string, unknown>[], columns: string[]): string {
  const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) => `| ${columns.map((column) => escapeMarkdownCell(formatCell(row[column]))).join(" | ")} |`
  );
  return [header, divider, ...body].join("\n");
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\r\n", "<br>").replaceAll("\n", "<br>");
}

function toInsertStatement(
  rows: Record<string, unknown>[],
  columns: string[],
  schema?: string,
  table?: string
): string {
  const target = [schema, table]
    .filter(Boolean)
    .map((part) => quoteSqlIdentifier(String(part)))
    .join(".");
  const tableTarget = target || quoteSqlIdentifier("table");
  const quotedColumns = columns.map(quoteSqlIdentifier).join(", ");
  const values = rows.map((row) => `(${columns.map((column) => toSqlLiteral(row[column])).join(", ")})`).join(", ");

  return `INSERT INTO ${tableTarget} (${quotedColumns}) VALUES ${values};`;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (value instanceof Date) {
    return quoteSqlString(value.toISOString());
  }

  if (typeof value === "object") {
    return quoteSqlString(JSON.stringify(value));
  }

  return quoteSqlString(String(value));
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

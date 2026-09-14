import type {
  DatabaseEngine,
  TableColumn,
  TableFilterInput,
  TableFilterOperator,
  TableFilterRule,
  TableSortInput
} from "../shared/types";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const FILTER_OPERATORS = new Set<TableFilterOperator>([
  "equals",
  "notEquals",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "contains",
  "notContains",
  "startsWith",
  "notStartsWith",
  "endsWith",
  "notEndsWith",
  "isNull",
  "isNotNull",
  "in",
  "notIn"
]);
const VALUELESS_FILTER_OPERATORS = new Set<TableFilterOperator>(["isNull", "isNotNull"]);
const COMPARISON_FILTER_OPERATORS = new Set<TableFilterOperator>([
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual"
]);
const NEGATED_ANY_COLUMN_OPERATORS = new Set<TableFilterOperator>([
  "notEquals",
  "notContains",
  "notStartsWith",
  "notEndsWith",
  "notIn"
]);

export type SqlDialect = DatabaseEngine;

export type SqlStatement = {
  sql: string;
  params: unknown[];
};

type FilterWhereSql = {
  whereClause: string;
  params: unknown[];
};

type FilterExpressionSql = {
  sql: string;
  params: unknown[];
};

export function quoteIdentifier(identifier: string, dialect: SqlDialect = "postgresql"): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  if (dialect === "mysql") {
    return `\`${identifier.replaceAll("`", "``")}\``;
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

export function buildCreateDatabaseSql(databaseName: string): string {
  return `create database ${quotePostgresDatabaseName(databaseName)}`;
}

export function buildDropDatabaseSql(databaseName: string): string {
  return `drop database ${quotePostgresDatabaseName(databaseName)}`;
}

function quotePostgresDatabaseName(databaseName: string): string {
  if (typeof databaseName !== "string" || !databaseName.trim()) {
    throw new Error("Database name is required.");
  }

  const normalizedName = databaseName.trim();
  if (normalizedName.includes("\0") || Buffer.byteLength(normalizedName, "utf8") > 63) {
    throw new Error("Database name must be at most 63 bytes and cannot contain null characters.");
  }

  return `"${normalizedName.replaceAll('"', '""')}"`;
}

export function quoteQualifiedName(schema: string, table: string, dialect: SqlDialect = "postgresql"): string {
  if (dialect === "sqlite") {
    return `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(table, dialect)}`;
  }

  return `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(table, dialect)}`;
}

export function buildSelectTableSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  pageSizePlaceholder = placeholder(dialect, 1),
  offsetPlaceholder = placeholder(dialect, 2)
): string {
  return `select * from ${quoteQualifiedName(schema, table, dialect)} limit ${pageSizePlaceholder} offset ${offsetPlaceholder}`;
}

export function buildCountTableSql(dialect: SqlDialect, schema: string, table: string): string {
  const countExpression = dialect === "postgresql" ? "count(*)::int" : "count(*)";
  return `select ${countExpression} as count from ${quoteQualifiedName(schema, table, dialect)}`;
}

export function buildFilteredSelectTableSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  columns: TableColumn[],
  filters: TableFilterInput | undefined,
  pageSize: number,
  offset: number,
  sort?: TableSortInput | null
): SqlStatement {
  const filterSql = buildTableFilterWhereSql(dialect, filters, columns);
  const orderSql = buildTableSortOrderSql(dialect, sort, columns);
  const limitIndex = filterSql.params.length + 1;
  const offsetIndex = filterSql.params.length + 2;

  return {
    sql: `select * from ${quoteQualifiedName(
      schema,
      table,
      dialect
    )}${filterSql.whereClause}${orderSql} limit ${placeholder(dialect, limitIndex)} offset ${placeholder(
      dialect,
      offsetIndex
    )}`,
    params: [...filterSql.params, pageSize, offset]
  };
}

export function buildFilteredCountTableSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  columns: TableColumn[],
  filters?: TableFilterInput
): SqlStatement {
  const filterSql = buildTableFilterWhereSql(dialect, filters, columns);
  const countExpression = dialect === "postgresql" ? "count(*)::int" : "count(*)";

  return {
    sql: `select ${countExpression} as count from ${quoteQualifiedName(schema, table, dialect)}${filterSql.whereClause}`,
    params: filterSql.params
  };
}

export function formatSqlStatementForHistory(statement: SqlStatement, dialect: SqlDialect): string {
  if (statement.params.length === 0) {
    return statement.sql;
  }

  if (dialect === "postgresql") {
    return statement.sql.replace(/\$(\d+)/g, (match, indexText: string) => {
      const paramIndex = Number(indexText) - 1;
      return paramIndex in statement.params ? sqlLiteral(statement.params[paramIndex]) : match;
    });
  }

  let paramIndex = 0;
  return statement.sql.replace(/\?/g, (match) => {
    if (paramIndex >= statement.params.length) {
      return match;
    }

    const value = statement.params[paramIndex];
    paramIndex += 1;
    return sqlLiteral(value);
  });
}

export function buildTableFilterWhereSql(
  dialect: SqlDialect,
  filters: TableFilterInput | undefined,
  columns: TableColumn[],
  startParamIndex = 1
): FilterWhereSql {
  const expressions: string[] = [];
  const params: unknown[] = [];
  const columnsByName = new Map(columns.map((column) => [column.name, column]));

  for (const rule of filters?.rules ?? []) {
    if (!rule.enabled) {
      continue;
    }

    validateFilterOperator(rule.operator);

    if (!VALUELESS_FILTER_OPERATORS.has(rule.operator) && rule.value.trim() === "") {
      continue;
    }

    if ((rule.operator === "in" || rule.operator === "notIn") && listFilterValues(rule.value).length === 0) {
      continue;
    }

    const paramIndex = startParamIndex + params.length;
    const expression = rule.column
      ? buildSpecificColumnFilterExpression(dialect, rule, columnsByName, paramIndex)
      : buildAnyColumnFilterExpression(dialect, rule, columns, paramIndex);

    if (!expression) {
      continue;
    }

    expressions.push(expression.sql);
    params.push(...expression.params);
  }

  return {
    whereClause: expressions.length ? ` where ${expressions.join(" and ")}` : "",
    params
  };
}

export function buildTableSortOrderSql(
  dialect: SqlDialect,
  sort: TableSortInput | undefined | null,
  columns: TableColumn[]
): string {
  if (!sort) {
    return "";
  }

  const column = columns.find((item) => item.name === sort.column);
  if (!column) {
    throw new Error(`Unknown sort column: ${sort.column}`);
  }

  if (sort.direction !== "asc" && sort.direction !== "desc") {
    throw new Error(`Invalid sort direction: ${sort.direction}`);
  }

  return ` order by ${quoteIdentifier(column.name, dialect)} ${sort.direction}`;
}

function buildSpecificColumnFilterExpression(
  dialect: SqlDialect,
  rule: TableFilterRule,
  columnsByName: Map<string, TableColumn>,
  paramIndex: number
): FilterExpressionSql {
  const column = columnsByName.get(rule.column ?? "");

  if (!column) {
    throw new Error(`Unknown filter column: ${rule.column}`);
  }

  return buildColumnFilterExpression(dialect, quoteIdentifier(column.name, dialect), rule, paramIndex);
}

function buildAnyColumnFilterExpression(
  dialect: SqlDialect,
  rule: TableFilterRule,
  columns: TableColumn[],
  paramIndex: number
): FilterExpressionSql | null {
  if (COMPARISON_FILTER_OPERATORS.has(rule.operator)) {
    throw new Error(`Filter operator ${rule.operator} requires a specific column.`);
  }

  if (columns.length === 0) {
    return null;
  }

  const positiveOperator = positiveAnyColumnOperator(rule.operator);
  const expressions: string[] = [];
  const params: unknown[] = [];

  for (const column of columns) {
    const expression = buildColumnFilterExpression(
      dialect,
      quoteIdentifier(column.name, dialect),
      { ...rule, operator: positiveOperator },
      paramIndex + params.length
    );
    expressions.push(expression.sql);
    params.push(...expression.params);
  }

  const sql = `(${expressions.join(" or ")})`;
  return {
    sql: NEGATED_ANY_COLUMN_OPERATORS.has(rule.operator) ? `not ${sql}` : sql,
    params
  };
}

function buildColumnFilterExpression(
  dialect: SqlDialect,
  columnSql: string,
  rule: TableFilterRule,
  paramIndex: number
): FilterExpressionSql {
  const param = placeholder(dialect, paramIndex);
  const textSql = textExpression(dialect, columnSql);

  switch (rule.operator) {
    case "equals":
      return { sql: `${textSql} = ${param}`, params: [rule.value.trim()] };
    case "notEquals":
      return { sql: nullSafeNotEqualsExpression(dialect, textSql, param), params: [rule.value.trim()] };
    case "lessThan":
      return { sql: `${columnSql} < ${param}`, params: [rule.value.trim()] };
    case "lessThanOrEqual":
      return { sql: `${columnSql} <= ${param}`, params: [rule.value.trim()] };
    case "greaterThan":
      return { sql: `${columnSql} > ${param}`, params: [rule.value.trim()] };
    case "greaterThanOrEqual":
      return { sql: `${columnSql} >= ${param}`, params: [rule.value.trim()] };
    case "contains":
      return likeExpression(dialect, textSql, param, likePattern(rule, "contains"), false);
    case "notContains":
      return likeExpression(dialect, textSql, param, likePattern(rule, "contains"), true);
    case "startsWith":
      return likeExpression(dialect, textSql, param, likePattern(rule, "startsWith"), false);
    case "notStartsWith":
      return likeExpression(dialect, textSql, param, likePattern(rule, "startsWith"), true);
    case "endsWith":
      return likeExpression(dialect, textSql, param, likePattern(rule, "endsWith"), false);
    case "notEndsWith":
      return likeExpression(dialect, textSql, param, likePattern(rule, "endsWith"), true);
    case "isNull":
      return { sql: `${columnSql} is null`, params: [] };
    case "isNotNull":
      return { sql: `${columnSql} is not null`, params: [] };
    case "in":
      return inExpression(dialect, textSql, paramIndex, listFilterValues(rule.value), false);
    case "notIn":
      return inExpression(dialect, textSql, paramIndex, listFilterValues(rule.value), true);
  }
}

function likeExpression(
  dialect: SqlDialect,
  textSql: string,
  param: string,
  pattern: string,
  negated: boolean
): FilterExpressionSql {
  const expression =
    dialect === "postgresql"
      ? `${textSql} ilike ${param} escape '\\'`
      : `lower(${textSql}) like lower(${param}) escape '\\'`;

  return {
    sql: negated ? `not (${expression})` : expression,
    params: [pattern]
  };
}

function inExpression(
  dialect: SqlDialect,
  textSql: string,
  paramIndex: number,
  values: string[],
  negated: boolean
): FilterExpressionSql {
  if (dialect === "postgresql") {
    const expression = `${textSql} = any(${placeholder(dialect, paramIndex)}::text[])`;
    return {
      sql: negated ? `not (${expression})` : expression,
      params: [values]
    };
  }

  const placeholders = values.map((_, index) => placeholder(dialect, paramIndex + index)).join(", ");
  const expression = `${textSql} in (${placeholders})`;
  return {
    sql: negated ? `not (${expression})` : expression,
    params: values
  };
}

function nullSafeNotEqualsExpression(dialect: SqlDialect, textSql: string, param: string): string {
  if (dialect === "mysql") {
    return `not (${textSql} <=> ${param})`;
  }

  if (isSqliteDialect(dialect)) {
    return `not (${textSql} is ${param})`;
  }

  return `${textSql} is distinct from ${param}`;
}

function validateFilterOperator(operator: TableFilterOperator): void {
  if (!FILTER_OPERATORS.has(operator)) {
    throw new Error(`Invalid filter operator: ${operator}`);
  }
}

function positiveAnyColumnOperator(operator: TableFilterOperator): TableFilterOperator {
  switch (operator) {
    case "notEquals":
      return "equals";
    case "notContains":
      return "contains";
    case "notStartsWith":
      return "startsWith";
    case "notEndsWith":
      return "endsWith";
    case "notIn":
      return "in";
    default:
      return operator;
  }
}

function likePattern(rule: TableFilterRule, mode: "contains" | "startsWith" | "endsWith"): string {
  const escaped = escapeLikeValue(rule.value.trim());

  if (mode === "startsWith") {
    return `${escaped}%`;
  }

  if (mode === "endsWith") {
    return `%${escaped}`;
  }

  return `%${escaped}%`;
}

function escapeLikeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function listFilterValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildInsertSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  values: Record<string, unknown>
): SqlStatement {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    throw new Error("Insert requires at least one column value.");
  }

  const columns = entries.map(([column]) => quoteIdentifier(column, dialect)).join(", ");
  const placeholders = entries.map((_, index) => placeholder(dialect, index + 1)).join(", ");

  return {
    sql: `insert into ${quoteQualifiedName(schema, table, dialect)} (${columns}) values (${placeholders})`,
    params: entries.map(([, value]) => value)
  };
}

export function buildUpdateSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  key: Record<string, unknown>,
  values: Record<string, unknown>
): SqlStatement {
  const updateEntries = Object.entries(values).filter(([, value]) => value !== undefined);
  const keyEntries = Object.entries(key);

  if (updateEntries.length === 0) {
    throw new Error("Update requires at least one changed value.");
  }

  if (keyEntries.length === 0) {
    throw new Error("Update requires a primary key.");
  }

  const setClause = updateEntries
    .map(([column], index) => `${quoteIdentifier(column, dialect)} = ${placeholder(dialect, index + 1)}`)
    .join(", ");
  const whereClause = keyEntries
    .map(([column], index) =>
      nullSafeEqualsExpression(
        dialect,
        quoteIdentifier(column, dialect),
        placeholder(dialect, updateEntries.length + index + 1)
      )
    )
    .join(" and ");

  return {
    sql: `update ${quoteQualifiedName(schema, table, dialect)} set ${setClause} where ${whereClause}`,
    params: [...updateEntries.map(([, value]) => value), ...keyEntries.map(([, value]) => value)]
  };
}

export function buildDeleteSql(
  dialect: SqlDialect,
  schema: string,
  table: string,
  key: Record<string, unknown>
): SqlStatement {
  const keyEntries = Object.entries(key);

  if (keyEntries.length === 0) {
    throw new Error("Delete requires a primary key.");
  }

  const whereClause = keyEntries
    .map(([column], index) =>
      nullSafeEqualsExpression(dialect, quoteIdentifier(column, dialect), placeholder(dialect, index + 1))
    )
    .join(" and ");

  return {
    sql: `delete from ${quoteQualifiedName(schema, table, dialect)} where ${whereClause}`,
    params: keyEntries.map(([, value]) => value)
  };
}

function nullSafeEqualsExpression(dialect: SqlDialect, columnSql: string, param: string): string {
  if (dialect === "mysql") {
    return `${columnSql} <=> ${param}`;
  }

  if (isSqliteDialect(dialect)) {
    return `${columnSql} is ${param}`;
  }

  return `${columnSql} is not distinct from ${param}`;
}

function textExpression(dialect: SqlDialect, columnSql: string): string {
  if (dialect === "postgresql") {
    return `${columnSql}::text`;
  }

  if (dialect === "mysql") {
    return `cast(${columnSql} as char)`;
  }

  return `cast(${columnSql} as text)`;
}

function placeholder(dialect: SqlDialect, index: number): string {
  return dialect === "postgresql" ? `$${index}` : "?";
}

function isSqliteDialect(dialect: SqlDialect): boolean {
  return dialect === "sqlite" || dialect === "turso" || dialect === "cloudflare-d1";
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `array[${value.map(sqlLiteral).join(", ")}]`;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value instanceof Date) {
    return quoteSqlString(value.toISOString());
  }

  if (value instanceof Uint8Array) {
    return `x'${Buffer.from(value).toString("hex")}'`;
  }

  if (typeof value === "object") {
    return quoteSqlString(JSON.stringify(value));
  }

  return quoteSqlString(String(value));
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

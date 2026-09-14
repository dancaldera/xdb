import { createWriteStream } from "node:fs";
import type { Readable } from "node:stream";
import type pg from "pg";
import { to as copyTo } from "pg-copy-streams";

export type PostgresDumpProgress = {
  phase: "schema" | "data" | "finalizing";
  table?: string;
  tablesDone?: number;
  tablesTotal?: number;
};

export type PostgresDumpOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: PostgresDumpProgress) => void;
};

const SYSTEM_SCHEMA_FILTER = `
  n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%'
  and n.nspname not like 'pg_temp%'
`;

export async function createSqlDump(
  client: pg.ClientBase,
  filePath: string,
  options: PostgresDumpOptions = {}
): Promise<void> {
  const writer = createWriteStream(filePath, { encoding: "utf8" });

  try {
    await client.query("begin isolation level repeatable read read only");

    try {
      // Force pg_get_*def/pg_get_expr to schema-qualify every reference.
      await client.query("select pg_catalog.set_config('search_path', '', true)");
      await writeDump(client, writer, options);
      await client.query("commit");
    } catch (error) {
      // After an aborted COPY the connection is still in copy-out mode and a
      // ROLLBACK would queue forever; the caller destroys the connection.
      if (!options.signal?.aborted) {
        await client.query("rollback").catch(() => {});
      }
      throw error;
    }
  } finally {
    await closeWritable(writer);
  }
}

async function writeDump(
  client: pg.ClientBase,
  writer: NodeJS.WritableStream,
  options: PostgresDumpOptions
): Promise<void> {
  const { signal, onProgress } = options;
  const progress = (update: PostgresDumpProgress): void => {
    onProgress?.(update);
  };

  progress({ phase: "schema" });
  throwIfAborted(signal);

  // Sequential on purpose: a single client cannot pipeline queries.
  const serverVersion = await readServerVersionNum(client);
  const extensions = await listExtensions(client);
  const schemas = await listUserSchemas(client);
  const sequences = await listSequences(client);
  const tables = await listTables(client);
  const views = await listViews(client);

  await writeBackupLines(writer, [
    "-- XDB plain SQL backup",
    `-- Created at ${new Date().toISOString()}`,
    "",
    "BEGIN;",
    "SET client_min_messages = warning;",
    "SET standard_conforming_strings = on;",
    "SET check_function_bodies = false;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    ""
  ]);

  for (const schema of schemas) {
    await writeBackupLine(writer, `DROP SCHEMA IF EXISTS ${quoteSqlIdentifier(schema)} CASCADE;`);
  }

  await writeBackupLine(writer, "");

  for (const schema of schemas) {
    await writeBackupLine(writer, `CREATE SCHEMA ${quoteSqlIdentifier(schema)};`);
  }

  if (extensions.length) {
    await writeBackupLine(writer, "");
    for (const extension of extensions) {
      await writeBackupLine(
        writer,
        `CREATE EXTENSION IF NOT EXISTS ${quoteSqlIdentifier(extension.name)} WITH SCHEMA ${quoteSqlIdentifier(extension.schema)};`
      );
    }
  }

  throwIfAborted(signal);
  const types = await listUserTypes(client);
  if (types.length) {
    await writeBackupLine(writer, "");
    for (const type of types) {
      await writeBackupLine(writer, type.definition);
    }
  }

  throwIfAborted(signal);
  const functions = await listFunctions(client);
  if (functions.length) {
    await writeBackupLine(writer, "");
    for (const fn of functions) {
      await writeBackupLines(writer, [`${fn.definition.trimEnd()};`, ""]);
    }
  }

  const createdSequences = sequences.filter((sequence) => !sequence.internal);
  if (createdSequences.length) {
    await writeBackupLine(writer, "");
    for (const sequence of createdSequences) {
      await writeBackupLine(writer, buildSequenceDefinition(sequence));
    }
  }

  throwIfAborted(signal);
  for (const table of tables) {
    await writeBackupLines(writer, ["", ...(await buildTableDefinition(client, table))]);
  }

  const ownedSequences = createdSequences.filter((sequence) => sequence.ownedBy);
  if (ownedSequences.length) {
    await writeBackupLine(writer, "");
    for (const sequence of ownedSequences) {
      await writeBackupLine(
        writer,
        `ALTER SEQUENCE ${quoteQualifiedSqlName(sequence.schema, sequence.name)} OWNED BY ${sequence.ownedBy};`
      );
    }
  }

  const dataTables = tables.filter((table) => !table.isPartition);
  let tablesDone = 0;
  for (const table of dataTables) {
    throwIfAborted(signal);
    progress({
      phase: "data",
      table: `${table.schema}.${table.name}`,
      tablesDone,
      tablesTotal: dataTables.length
    });
    await writeTableCopyData(client, writer, table, signal);
    tablesDone += 1;
  }
  progress({ phase: "finalizing", tablesDone, tablesTotal: dataTables.length });

  if (sequences.length) {
    await writeBackupLine(writer, "");
    for (const sequence of sequences) {
      const state = await readSequenceState(client, sequence);
      if (state) {
        await writeBackupLine(
          writer,
          `SELECT setval(${quoteSqlLiteral(quoteQualifiedSqlName(sequence.schema, sequence.name))}, ${state.lastValue}, ${state.isCalled});`
        );
      }
    }
  }

  throwIfAborted(signal);
  for (const table of tables) {
    const constraints = await listTableConstraints(client, table.oid, false);
    for (const constraint of constraints) {
      await writeBackupLines(writer, [
        "",
        `ALTER TABLE ${table.kind === "p" ? "" : "ONLY "}${quoteQualifiedSqlName(table.schema, table.name)} ADD CONSTRAINT ${quoteSqlIdentifier(constraint.name)} ${constraint.definition};`
      ]);
    }
  }

  throwIfAborted(signal);
  for (const table of tables) {
    const indexes = await listTableIndexes(client, table.oid);
    if (indexes.length) {
      await writeBackupLine(writer, "");
      for (const index of indexes) {
        await writeBackupLine(writer, `${index.definition};`);
      }
    }
  }

  throwIfAborted(signal);
  for (const table of tables) {
    const constraints = await listTableConstraints(client, table.oid, true);
    for (const constraint of constraints) {
      await writeBackupLines(writer, [
        "",
        `ALTER TABLE ${table.kind === "p" ? "" : "ONLY "}${quoteQualifiedSqlName(table.schema, table.name)} ADD CONSTRAINT ${quoteSqlIdentifier(constraint.name)} ${constraint.definition};`
      ]);
    }
  }

  throwIfAborted(signal);
  const orderedViews = sortViewsByDependency(views, await listViewDependencies(client));
  for (const view of orderedViews) {
    const qualifiedName = quoteQualifiedSqlName(view.schema, view.name);
    // pg_get_viewdef emits a trailing semicolon that must not terminate the statement early.
    const definition = view.definition.trim().replace(/;$/, "");
    if (view.type === "materialized_view") {
      await writeBackupLines(writer, ["", `CREATE MATERIALIZED VIEW ${qualifiedName} AS`, definition, "WITH NO DATA;"]);
    } else {
      await writeBackupLines(writer, ["", `CREATE VIEW ${qualifiedName} AS`, `${definition};`]);
    }
  }

  const materializedViews = orderedViews.filter((view) => view.type === "materialized_view");
  if (materializedViews.length) {
    await writeBackupLine(writer, "");
    for (const view of materializedViews) {
      await writeBackupLine(writer, `REFRESH MATERIALIZED VIEW ${quoteQualifiedSqlName(view.schema, view.name)};`);
    }
  }

  throwIfAborted(signal);
  const triggers = await listTriggers(client, serverVersion);
  if (triggers.length) {
    await writeBackupLine(writer, "");
    for (const trigger of triggers) {
      await writeBackupLine(writer, `${trigger.definition.trimEnd()};`);
    }
  }

  throwIfAborted(signal);
  const comments = await listComments(client);
  if (comments.length) {
    await writeBackupLine(writer, "");
    for (const comment of comments) {
      await writeBackupLine(writer, comment);
    }
  }

  await writeBackupLines(writer, ["", "COMMIT;", ""]);
}

type BackupTable = {
  oid: string;
  schema: string;
  name: string;
  kind: "r" | "p";
  isPartition: boolean;
  partitionKey: string | null;
  partitionBound: string | null;
  parentSchema: string | null;
  parentName: string | null;
};

type BackupSequence = {
  oid: string;
  schema: string;
  name: string;
  dataType: string;
  startValue: string;
  increment: string;
  minValue: string;
  maxValue: string;
  cache: string;
  cycle: boolean;
  internal: boolean;
  ownedBy: string | null;
};

type BackupView = {
  oid: string;
  schema: string;
  name: string;
  type: "view" | "materialized_view";
  definition: string;
};

export type BackupColumn = {
  name: string;
  dataType: string;
  notNull: boolean;
  defaultExpression: string | null;
  identity: "" | "a" | "d";
  generated: "" | "s";
};

async function buildTableDefinition(client: pg.ClientBase, table: BackupTable): Promise<string[]> {
  const qualifiedName = quoteQualifiedSqlName(table.schema, table.name);

  if (table.isPartition && table.parentSchema && table.parentName && table.partitionBound) {
    const parent = quoteQualifiedSqlName(table.parentSchema, table.parentName);
    const partitionBy = table.kind === "p" && table.partitionKey ? ` PARTITION BY ${table.partitionKey}` : "";
    return [`CREATE TABLE ${qualifiedName} PARTITION OF ${parent} ${table.partitionBound}${partitionBy};`];
  }

  const columns = await listTableColumns(client, table.oid);
  const columnDefinitions = columns.map((column) => `  ${buildColumnDefinition(column)}`);
  const partitionBy = table.kind === "p" && table.partitionKey ? ` PARTITION BY ${table.partitionKey}` : "";

  return [`CREATE TABLE ${qualifiedName} (`, columnDefinitions.join(",\n"), `)${partitionBy};`];
}

async function writeTableCopyData(
  client: pg.ClientBase,
  writer: NodeJS.WritableStream,
  table: BackupTable,
  signal?: AbortSignal
): Promise<void> {
  const columns = (await listTableColumns(client, table.oid)).filter((column) => column.generated === "");
  if (!columns.length) {
    return;
  }

  const qualifiedName = quoteQualifiedSqlName(table.schema, table.name);
  const columnList = columns.map((column) => quoteSqlIdentifier(column.name)).join(", ");
  // ONLY keeps legacy-inheritance children out; partitioned parents need the
  // plain form so partition rows are included.
  const source = table.kind === "p" ? qualifiedName : `ONLY ${qualifiedName}`;

  await writeBackupLines(writer, ["", `COPY ${qualifiedName} (${columnList}) FROM stdin;`]);

  const stream = client.query(copyTo(`COPY (SELECT ${columnList} FROM ${source}) TO STDOUT`));
  await pipeToWriter(stream, writer, signal);
  await writeBackupLine(writer, "\\.");
}

function pipeToWriter(readable: Readable, writer: NodeJS.WritableStream, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      readable.destroy(new Error("Backup cancelled."));
    };

    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      readable.removeListener("data", onData);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const onData = (chunk: Buffer | string): void => {
      if (!writer.write(chunk)) {
        readable.pause();
        writer.once("drain", () => readable.resume());
      }
    };

    readable.on("data", onData);
    readable.once("end", () => settle());
    // Keep the error listener attached: a destroyed copy stream can emit
    // late errors that would otherwise crash the process.
    readable.on("error", (error: Error) => settle(error));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Backup cancelled.");
  }
}

async function readServerVersionNum(client: pg.ClientBase): Promise<number> {
  const result = await client.query<{ version: string }>("select current_setting('server_version_num') as version");
  return Number.parseInt(result.rows[0]?.version ?? "0", 10);
}

async function listExtensions(client: pg.ClientBase): Promise<Array<{ name: string; schema: string }>> {
  const result = await client.query<{ name: string; schema: string }>(`
    select e.extname as name, n.nspname as schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname <> 'plpgsql'
    order by e.extname
  `);
  return result.rows;
}

async function listUserSchemas(client: pg.ClientBase): Promise<string[]> {
  const result = await client.query<{ name: string }>(`
    select nspname as name
    from pg_namespace n
    where ${SYSTEM_SCHEMA_FILTER}
    order by case when nspname = 'public' then 0 else 1 end, nspname
  `);
  return result.rows.map((row) => row.name);
}

async function listSequences(client: pg.ClientBase): Promise<BackupSequence[]> {
  const result = await client.query<{
    oid: string;
    schema: string;
    name: string;
    data_type: string;
    start_value: string;
    increment: string;
    min_value: string;
    max_value: string;
    cache: string;
    cycle: boolean;
    internal: boolean;
    owned_by: string | null;
  }>(`
    select
      c.oid::text as oid,
      n.nspname as schema,
      c.relname as name,
      format_type(s.seqtypid, null) as data_type,
      s.seqstart::text as start_value,
      s.seqincrement::text as increment,
      s.seqmin::text as min_value,
      s.seqmax::text as max_value,
      s.seqcache::text as cache,
      s.seqcycle as cycle,
      exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'i'
      ) as internal,
      (
        select quote_ident(dn.nspname) || '.' || quote_ident(dc.relname) || '.' || quote_ident(da.attname)
        from pg_depend d
        join pg_class dc on dc.oid = d.refobjid
        join pg_namespace dn on dn.oid = dc.relnamespace
        join pg_attribute da on da.attrelid = d.refobjid and da.attnum = d.refobjsubid
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.refclassid = 'pg_class'::regclass
          and d.deptype = 'a'
        limit 1
      ) as owned_by
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_sequence s on s.seqrelid = c.oid
    where c.relkind = 'S'
      and ${SYSTEM_SCHEMA_FILTER}
    order by n.nspname, c.relname
  `);

  return result.rows.map((row) => ({
    oid: row.oid,
    schema: row.schema,
    name: row.name,
    dataType: row.data_type,
    startValue: row.start_value,
    increment: row.increment,
    minValue: row.min_value,
    maxValue: row.max_value,
    cache: row.cache,
    cycle: row.cycle,
    internal: row.internal,
    ownedBy: row.owned_by
  }));
}

export function buildSequenceDefinition(sequence: {
  schema: string;
  name: string;
  dataType: string;
  startValue: string;
  increment: string;
  minValue: string;
  maxValue: string;
  cache: string;
  cycle: boolean;
}): string {
  const parts = [`CREATE SEQUENCE ${quoteQualifiedSqlName(sequence.schema, sequence.name)}`];

  if (sequence.dataType !== "bigint") {
    parts.push(`AS ${sequence.dataType}`);
  }

  parts.push(
    `INCREMENT BY ${sequence.increment}`,
    `MINVALUE ${sequence.minValue}`,
    `MAXVALUE ${sequence.maxValue}`,
    `START WITH ${sequence.startValue}`,
    `CACHE ${sequence.cache}`
  );

  if (sequence.cycle) {
    parts.push("CYCLE");
  }

  return `${parts.join(" ")};`;
}

async function listUserTypes(client: pg.ClientBase): Promise<Array<{ definition: string }>> {
  const enumResult = await client.query<{ schema: string; name: string; labels_sql: string }>(`
    select
      n.nspname as schema,
      t.typname as name,
      string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) as labels_sql
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where t.typtype = 'e'
      and ${SYSTEM_SCHEMA_FILTER}
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_type'::regclass
          and d.objid = t.oid
          and d.deptype = 'e'
      )
    group by n.nspname, t.typname
    order by n.nspname, t.typname
  `);
  const domainResult = await client.query<{
    schema: string;
    name: string;
    base_type: string;
    not_null: boolean;
    default_expression: string | null;
    constraints: string | null;
  }>(`
    select
      n.nspname as schema,
      t.typname as name,
      format_type(t.typbasetype, t.typtypmod) as base_type,
      t.typnotnull as not_null,
      t.typdefault as default_expression,
      (
        select string_agg(pg_get_constraintdef(con.oid, true), ' ' order by con.conname)
        from pg_constraint con
        where con.contypid = t.oid
      ) as constraints
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'd'
      and ${SYSTEM_SCHEMA_FILTER}
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_type'::regclass
          and d.objid = t.oid
          and d.deptype = 'e'
      )
    order by n.nspname, t.typname
  `);

  return [
    ...enumResult.rows.map((row) => ({
      definition: `CREATE TYPE ${quoteQualifiedSqlName(row.schema, row.name)} AS ENUM (${row.labels_sql});`
    })),
    ...domainResult.rows.map((row) => ({
      definition: [
        `CREATE DOMAIN ${quoteQualifiedSqlName(row.schema, row.name)} AS ${row.base_type}`,
        row.default_expression ? `DEFAULT ${row.default_expression}` : "",
        row.not_null ? "NOT NULL" : "",
        row.constraints ?? ""
      ]
        .filter(Boolean)
        .join(" ")
        .concat(";")
    }))
  ];
}

async function listFunctions(client: pg.ClientBase): Promise<Array<{ definition: string }>> {
  const result = await client.query<{ definition: string }>(`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.prokind in ('f', 'p')
      and ${SYSTEM_SCHEMA_FILTER}
      and l.lanname not in ('internal', 'c')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
    order by n.nspname, p.proname, p.oid
  `);
  return result.rows;
}

async function listTables(client: pg.ClientBase): Promise<BackupTable[]> {
  const result = await client.query<{
    oid: string;
    schema: string;
    name: string;
    kind: "r" | "p";
    is_partition: boolean;
    partition_key: string | null;
    partition_bound: string | null;
    parent_schema: string | null;
    parent_name: string | null;
  }>(`
    select
      c.oid::text as oid,
      n.nspname as schema,
      c.relname as name,
      c.relkind as kind,
      c.relispartition as is_partition,
      case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end as partition_key,
      case when c.relispartition then pg_get_expr(c.relpartbound, c.oid) end as partition_bound,
      (
        select pn.nspname
        from pg_inherits i
        join pg_class pc on pc.oid = i.inhparent
        join pg_namespace pn on pn.oid = pc.relnamespace
        where i.inhrelid = c.oid
        limit 1
      ) as parent_schema,
      (
        select pc.relname
        from pg_inherits i
        join pg_class pc on pc.oid = i.inhparent
        where i.inhrelid = c.oid
        limit 1
      ) as parent_name,
      (
        with recursive ancestors(relid) as (
          select i.inhparent from pg_inherits i where i.inhrelid = c.oid
          union all
          select i.inhparent from pg_inherits i join ancestors a on i.inhrelid = a.relid
        )
        select count(*) from ancestors
      )::int as depth
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and ${SYSTEM_SCHEMA_FILTER}
    order by depth, n.nspname, c.relname
  `);

  return result.rows.map((row) => ({
    oid: row.oid,
    schema: row.schema,
    name: row.name,
    kind: row.kind,
    isPartition: row.is_partition,
    partitionKey: row.partition_key,
    partitionBound: row.partition_bound,
    parentSchema: row.parent_schema,
    parentName: row.parent_name
  }));
}

async function listViews(client: pg.ClientBase): Promise<BackupView[]> {
  const result = await client.query<{
    oid: string;
    schema: string;
    name: string;
    type: "view" | "materialized_view";
    definition: string;
  }>(`
    select
      c.oid::text as oid,
      n.nspname as schema,
      c.relname as name,
      case c.relkind when 'm' then 'materialized_view' else 'view' end as type,
      pg_get_viewdef(c.oid, true) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm')
      and ${SYSTEM_SCHEMA_FILTER}
    order by n.nspname, c.relkind, c.relname
  `);
  return result.rows;
}

async function listViewDependencies(client: pg.ClientBase): Promise<Array<{ viewOid: string; dependsOnOid: string }>> {
  const result = await client.query<{ view_oid: string; depends_on_oid: string }>(`
    select distinct dependent.oid::text as view_oid, source.oid::text as depends_on_oid
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class dependent on dependent.oid = r.ev_class
    join pg_class source on source.oid = d.refobjid
    where d.classid = 'pg_rewrite'::regclass
      and d.refclassid = 'pg_class'::regclass
      and dependent.relkind in ('v', 'm')
      and source.relkind in ('v', 'm')
      and dependent.oid <> source.oid
  `);
  return result.rows.map((row) => ({ viewOid: row.view_oid, dependsOnOid: row.depends_on_oid }));
}

export function sortViewsByDependency<T extends { oid: string }>(
  views: T[],
  dependencies: Array<{ viewOid: string; dependsOnOid: string }>
): T[] {
  const knownOids = new Set(views.map((view) => view.oid));
  const blockers = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const view of views) {
    blockers.set(view.oid, new Set());
  }
  for (const edge of dependencies) {
    if (!knownOids.has(edge.viewOid) || !knownOids.has(edge.dependsOnOid)) {
      continue;
    }
    blockers.get(edge.viewOid)?.add(edge.dependsOnOid);
    if (!dependents.has(edge.dependsOnOid)) {
      dependents.set(edge.dependsOnOid, new Set());
    }
    dependents.get(edge.dependsOnOid)?.add(edge.viewOid);
  }

  const ready = views.filter((view) => blockers.get(view.oid)?.size === 0);
  const sorted: T[] = [];
  const byOid = new Map(views.map((view) => [view.oid, view]));

  while (ready.length) {
    const view = ready.shift() as T;
    sorted.push(view);
    for (const dependentOid of dependents.get(view.oid) ?? []) {
      const remaining = blockers.get(dependentOid);
      remaining?.delete(view.oid);
      if (remaining?.size === 0) {
        const dependent = byOid.get(dependentOid);
        if (dependent) {
          ready.push(dependent);
        }
      }
    }
  }

  // Cycles should be impossible between views; fall back to input order.
  return sorted.length === views.length ? sorted : views;
}

async function listTableColumns(client: pg.ClientBase, tableOid: string): Promise<BackupColumn[]> {
  const result = await client.query<{
    name: string;
    data_type: string;
    not_null: boolean;
    default_expression: string | null;
    identity: "" | "a" | "d";
    generated: "" | "s";
  }>(
    `
      select
        a.attname as name,
        format_type(a.atttypid, a.atttypmod) as data_type,
        a.attnotnull as not_null,
        pg_get_expr(ad.adbin, ad.adrelid) as default_expression,
        a.attidentity as identity,
        a.attgenerated as generated
      from pg_attribute a
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
      where a.attrelid = $1::oid
        and a.attnum > 0
        and not a.attisdropped
      order by a.attnum
    `,
    [tableOid]
  );

  return result.rows.map((row) => ({
    name: row.name,
    dataType: row.data_type,
    notNull: row.not_null,
    defaultExpression: row.default_expression,
    identity: row.identity,
    generated: row.generated
  }));
}

export function buildColumnDefinition(column: BackupColumn): string {
  const parts = [quoteSqlIdentifier(column.name), column.dataType];

  if (column.generated === "s" && column.defaultExpression) {
    parts.push(`GENERATED ALWAYS AS (${column.defaultExpression}) STORED`);
  } else if (column.identity) {
    parts.push(`GENERATED ${column.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`);
  } else if (column.defaultExpression) {
    parts.push(`DEFAULT ${column.defaultExpression}`);
  }

  if (column.notNull) {
    parts.push("NOT NULL");
  }

  return parts.join(" ");
}

async function readSequenceState(
  client: pg.ClientBase,
  sequence: { schema: string; name: string }
): Promise<{ lastValue: string; isCalled: boolean } | null> {
  const result = await client.query<{ last_value: string; is_called: boolean }>(
    `select last_value::text, is_called from ${quoteQualifiedSqlName(sequence.schema, sequence.name)}`
  );
  const row = result.rows[0];
  return row ? { lastValue: row.last_value, isCalled: row.is_called } : null;
}

async function listTableConstraints(
  client: pg.ClientBase,
  tableOid: string,
  foreignKeys: boolean
): Promise<Array<{ name: string; definition: string }>> {
  const result = await client.query<{ name: string; definition: string }>(
    `
      select conname as name, pg_get_constraintdef(oid, true) as definition
      from pg_constraint
      where conrelid = $1::oid
        and conislocal
        and ${foreignKeys ? "contype = 'f'" : "contype in ('p', 'u', 'c')"}
      order by case contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end, conname
    `,
    [tableOid]
  );
  return result.rows;
}

async function listTableIndexes(client: pg.ClientBase, tableOid: string): Promise<Array<{ definition: string }>> {
  const result = await client.query<{ definition: string }>(
    `
      select pg_get_indexdef(i.indexrelid) as definition
      from pg_index i
      where i.indrelid = $1::oid
        and not i.indisprimary
        and not exists (
          select 1
          from pg_constraint c
          where c.conindid = i.indexrelid
        )
        and not exists (
          select 1
          from pg_inherits inh
          where inh.inhrelid = i.indexrelid
        )
      order by i.indexrelid::regclass::text
    `,
    [tableOid]
  );
  return result.rows;
}

async function listTriggers(client: pg.ClientBase, serverVersion: number): Promise<Array<{ definition: string }>> {
  // tgparentid (partition trigger inheritance) exists since PostgreSQL 13.
  const parentFilter = serverVersion >= 130000 ? "and t.tgparentid = 0" : "";
  const result = await client.query<{ definition: string }>(`
    select pg_get_triggerdef(t.oid, true) as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      ${parentFilter}
      and ${SYSTEM_SCHEMA_FILTER}
    order by n.nspname, c.relname, t.tgname
  `);
  return result.rows;
}

async function listComments(client: pg.ClientBase): Promise<string[]> {
  const schemaResult = await client.query<{ name: string; description: string }>(`
    select n.nspname as name, d.description
    from pg_description d
    join pg_namespace n on n.oid = d.objoid
    where d.classoid = 'pg_namespace'::regclass
      and ${SYSTEM_SCHEMA_FILTER}
    order by n.nspname
  `);
  const relationResult = await client.query<{
    schema: string;
    name: string;
    kind: string;
    column_name: string | null;
    description: string;
  }>(`
    select
      n.nspname as schema,
      c.relname as name,
      c.relkind as kind,
      a.attname as column_name,
      d.description
    from pg_description d
    join pg_class c on c.oid = d.objoid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
    where d.classoid = 'pg_class'::regclass
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and (d.objsubid = 0 or a.attname is not null)
      and ${SYSTEM_SCHEMA_FILTER}
    order by n.nspname, c.relname, d.objsubid
  `);

  const relationKeyword: Record<string, string> = {
    r: "TABLE",
    p: "TABLE",
    v: "VIEW",
    m: "MATERIALIZED VIEW",
    S: "SEQUENCE"
  };

  return [
    ...schemaResult.rows.map(
      (row) => `COMMENT ON SCHEMA ${quoteSqlIdentifier(row.name)} IS ${quoteSqlLiteral(row.description)};`
    ),
    ...relationResult.rows.map((row) => {
      if (row.column_name) {
        return `COMMENT ON COLUMN ${quoteQualifiedSqlName(row.schema, row.name)}.${quoteSqlIdentifier(row.column_name)} IS ${quoteSqlLiteral(row.description)};`;
      }
      return `COMMENT ON ${relationKeyword[row.kind]} ${quoteQualifiedSqlName(row.schema, row.name)} IS ${quoteSqlLiteral(row.description)};`;
    })
  ];
}

async function writeBackupLines(writer: NodeJS.WritableStream, lines: string[]): Promise<void> {
  for (const line of lines) {
    await writeBackupLine(writer, line);
  }
}

function writeBackupLine(writer: NodeJS.WritableStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.write(`${line}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeWritable(writer: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once("finish", resolve);
    writer.once("error", reject);
    writer.end();
  });
}

export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function quoteQualifiedSqlName(schema: string, name: string): string {
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}`;
}

export function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

import {
  createClient,
  type Client as TursoClient,
  type ResultSet as TursoResultSet
} from "@tursodatabase/serverless/compat";
import pg from "pg";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  ConnectionInput,
  ConnectionProfile,
  ConnectionStatus,
  DatabaseBackupResult,
  DatabaseEngine,
  DatabaseInfo,
  DatabaseObject,
  DatabaseBackupProgress,
  DatabaseRestoreProgress,
  DatabaseRestoreResult,
  DeleteRowInput,
  QueryExecutionResult,
  QueryHistoryItem,
  TableColumn,
  TableDataResult,
  TableFilterInput,
  TableSortInput,
  TableIndex,
  TableStructure,
  UpdateRowInput,
  UpsertRowInput
} from "../shared/types";
import { normalizeConnectionInput } from "../shared/connections";
import {
  buildCreateDatabaseSql,
  buildDeleteSql,
  buildDropDatabaseSql,
  buildFilteredCountTableSql,
  buildFilteredSelectTableSql,
  buildInsertSql,
  buildUpdateSql,
  formatSqlStatementForHistory,
  quoteIdentifier
} from "./sql";
import type { AppStore } from "./store";
import { createSqlDump } from "./postgres-dump";
import { isCustomFormatDump, restoreSqlFile } from "./postgres-restore";

const { Pool } = pg;

type PoolEntry = {
  pool: pg.Pool;
  profile: ConnectionProfile;
};

type ConnectedPool = {
  pool: pg.Pool;
  profile: ConnectionProfile & { password: string };
  status: ConnectionStatus;
};

type DatabaseBackupOptions = {
  taskId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DatabaseBackupProgress) => void;
};

type DatabaseRestoreOptions = {
  taskId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DatabaseRestoreProgress) => void;
};

type HistoryItemOptions = Pick<QueryHistoryItem, "source" | "target">;

type ConcreteSslMode = Exclude<ConnectionProfile["sslMode"], "prefer">;

type DatabaseAdapter = {
  readonly engine: DatabaseEngine;
  connect(profileId: string, password?: string): Promise<ConnectionStatus>;
  disconnect(profileId: string): Promise<void>;
  closeAll(): Promise<void>;
  listObjects(profileId: string): Promise<DatabaseObject[]>;
  getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure>;
  getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult>;
  executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult>;
  insertRow(input: UpsertRowInput): Promise<void>;
  updateRow(input: UpdateRowInput): Promise<void>;
  deleteRow(input: DeleteRowInput): Promise<void>;
};

export class DatabaseService {
  private readonly adapters: Record<DatabaseEngine, DatabaseAdapter>;

  constructor(private readonly store: AppStore) {
    this.adapters = {
      postgresql: new PostgresService(store),
      mysql: new MysqlService(store),
      sqlite: new SqliteService(store),
      turso: new TursoService(store),
      "cloudflare-d1": new CloudflareD1Service(store)
    };
  }

  async saveConnection(input: ConnectionInput): Promise<ConnectionProfile> {
    return this.store.saveConnection(normalizeConnectionInput(input));
  }

  async connect(profileId: string, password?: string): Promise<ConnectionStatus> {
    const adapter = await this.getAdapterForProfile(profileId);
    return adapter.connect(profileId, password);
  }

  async disconnect(profileId: string): Promise<void> {
    await Promise.all(Object.values(this.adapters).map((adapter) => adapter.disconnect(profileId)));
  }

  async closeAll(): Promise<void> {
    await Promise.all(Object.values(this.adapters).map((adapter) => adapter.closeAll()));
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    return (await this.getAdapterForProfile(profileId)).listObjects(profileId);
  }

  async listDatabases(profileId: string): Promise<DatabaseInfo[]> {
    const adapter = await this.getAdapterForProfile(profileId);
    if (!(adapter instanceof PostgresService)) {
      throw new Error("Listing databases is currently available for PostgreSQL connections only.");
    }
    return adapter.listDatabases(profileId);
  }

  async createDatabase(profileId: string, databaseName: string): Promise<void> {
    const adapter = await this.getAdapterForProfile(profileId);
    if (!(adapter instanceof PostgresService)) {
      throw new Error("Creating databases is currently available for PostgreSQL connections only.");
    }
    await adapter.createDatabase(profileId, databaseName);
  }

  async dropDatabase(profileId: string, databaseName: string): Promise<void> {
    const adapter = await this.getAdapterForProfile(profileId);
    if (!(adapter instanceof PostgresService)) {
      throw new Error("Dropping databases is currently available for PostgreSQL connections only.");
    }
    await adapter.dropDatabase(profileId, databaseName);
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    return (await this.getAdapterForProfile(profileId)).getTableStructure(profileId, schema, table);
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    return (await this.getAdapterForProfile(profileId)).getTableData(
      profileId,
      schema,
      table,
      page,
      pageSize,
      filters,
      sort
    );
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    return (await this.getAdapterForProfile(profileId)).executeQuery(profileId, sql);
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    return (await this.getAdapterForProfile(input.profileId)).insertRow(input);
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    return (await this.getAdapterForProfile(input.profileId)).updateRow(input);
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    return (await this.getAdapterForProfile(input.profileId)).deleteRow(input);
  }

  async backupDatabase(
    profileId: string,
    backupDirectory: string,
    password?: string,
    options: DatabaseBackupOptions = {}
  ): Promise<DatabaseBackupResult> {
    const profile = await this.getProfile(profileId);
    if (profile.engine !== "postgresql") {
      throw new Error("Backup is currently available for PostgreSQL connections only.");
    }

    return (this.adapters.postgresql as PostgresService).backupDatabase(profileId, backupDirectory, password, options);
  }

  async restoreDatabase(
    profileId: string,
    filePath: string,
    password?: string,
    options: DatabaseRestoreOptions = {}
  ): Promise<DatabaseRestoreResult> {
    const profile = await this.getProfile(profileId);
    if (profile.engine !== "postgresql") {
      throw new Error("Restore is currently available for PostgreSQL connections only.");
    }

    return (this.adapters.postgresql as PostgresService).restoreDatabase(profileId, filePath, password, options);
  }

  private async getAdapterForProfile(profileId: string): Promise<DatabaseAdapter> {
    const profile = await this.getProfile(profileId);
    if (profile.kind === "storage" || profile.engine === "s3-compatible") {
      throw new Error("This connection is not a database connection.");
    }
    return this.adapters[profile.engine];
  }

  private async getProfile(profileId: string): Promise<ConnectionProfile> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }

    return profile;
  }
}

export class PostgresService {
  readonly engine = "postgresql" as const;
  private readonly pools = new Map<string, PoolEntry>();

  constructor(private readonly store: AppStore) {}

  async saveConnection(input: ConnectionInput): Promise<ConnectionProfile> {
    return this.store.saveConnection(normalizeConnectionInput(input));
  }

  async connect(profileId: string, password?: string): Promise<ConnectionStatus> {
    const profile = await this.getProfileWithPassword(profileId, password);
    const previous = this.pools.get(profileId);

    if (previous) {
      await previous.pool.end();
      this.pools.delete(profileId);
    }

    const { pool, profile: connectedProfile, status } = await this.createConnectedPool(profile);
    this.pools.set(profileId, { pool, profile: connectedProfile });
    return status;
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.pools.get(profileId);
    if (!entry) {
      return;
    }

    await entry.pool.end();
    this.pools.delete(profileId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map((entry) => entry.pool.end()));
    this.pools.clear();
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    const pool = this.getPool(profileId);
    const result = await pool.query<{
      schema: string;
      name: string;
      type: DatabaseObject["type"];
      estimated_rows: number | string | null;
    }>(`
      select
        n.nspname as schema,
        c.relname as name,
        case c.relkind
          when 'r' then 'base_table'
          when 'v' then 'view'
          when 'm' then 'materialized_view'
          when 'f' then 'foreign_table'
        end as type,
        greatest(c.reltuples::bigint, 0)::int as estimated_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'v', 'm', 'f')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg_toast%'
      order by n.nspname, c.relkind, c.relname
    `);

    return result.rows.map((row) => ({
      schema: row.schema,
      name: row.name,
      type: row.type,
      estimatedRows: row.estimated_rows === null ? null : Number.parseInt(String(row.estimated_rows), 10)
    }));
  }

  async listDatabases(profileId: string): Promise<DatabaseInfo[]> {
    const pool = this.getPool(profileId);
    const result = await pool.query<{
      name: string;
      owner: string | null;
      is_current: boolean;
      can_drop: boolean;
    }>(`
      select
        d.datname as name,
        pg_catalog.pg_get_userbyid(d.datdba) as owner,
        d.datname = current_database() as is_current,
        pg_catalog.pg_has_role(current_user, d.datdba, 'USAGE') as can_drop
      from pg_database d
      where d.datistemplate = false and d.datallowconn = true
      order by d.datname
    `);

    return result.rows.map((row) => ({
      name: row.name,
      owner: row.owner,
      isCurrent: row.is_current,
      canDrop: row.can_drop
    }));
  }

  async createDatabase(profileId: string, databaseName: string): Promise<void> {
    await this.getPool(profileId).query(buildCreateDatabaseSql(databaseName));
  }

  async dropDatabase(profileId: string, databaseName: string): Promise<void> {
    const statement = buildDropDatabaseSql(databaseName);
    const pool = this.getPool(profileId);
    const current = await pool.query<{ name: string }>("select current_database() as name");

    if (current.rows[0]?.name === databaseName.trim()) {
      throw new Error("The database used by this connection cannot be dropped.");
    }

    await pool.query(statement);
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    const pool = this.getPool(profileId);
    const [columns, indexes, primaryKeys] = await Promise.all([
      this.getColumns(pool, schema, table),
      this.getIndexes(pool, schema, table),
      this.getPrimaryKeys(pool, schema, table)
    ]);

    return {
      schema,
      table,
      columns: columns.map((column) => ({
        ...column,
        isPrimaryKey: primaryKeys.includes(column.name)
      })),
      indexes,
      primaryKeys
    };
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(pageSize, 10), 500);
    const offset = (safePage - 1) * safePageSize;
    const pool = this.getPool(profileId);
    const structure = await this.getTableStructure(profileId, schema, table);
    const countStatement = buildFilteredCountTableSql(this.engine, schema, table, structure.columns, filters);
    const rowsStatement = buildFilteredSelectTableSql(
      this.engine,
      schema,
      table,
      structure.columns,
      filters,
      safePageSize,
      offset,
      sort
    );
    const startedAt = performance.now();
    const [countResult, rowsResult] = await Promise.all([
      pool.query<{ count: number }>(countStatement.sql, countStatement.params),
      pool.query<Record<string, unknown>>(rowsStatement.sql, rowsStatement.params)
    ]);
    const durationMs = Math.round(performance.now() - startedAt);

    await this.store.addHistory(
      this.createHistoryItem(
        profileId,
        formatSqlStatementForHistory(rowsStatement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: rowsResult.rows.length,
          command: "SELECT",
          durationMs
        },
        { source: "table-data", target: { schema, table, action: "select" } }
      )
    );

    return {
      schema,
      table,
      rows: rowsResult.rows,
      columns: structure.columns,
      primaryKeys: structure.primaryKeys,
      totalRows: Number(countResult.rows[0]?.count ?? 0),
      page: safePage,
      pageSize: safePageSize
    };
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) {
      throw new Error("Query cannot be empty.");
    }

    const pool = this.getPool(profileId);
    const startedAt = performance.now();
    const rawResult = await pool.query(sql);
    const durationMs = Math.round(performance.now() - startedAt);
    const result = Array.isArray(rawResult) ? rawResult.at(-1) : rawResult;

    const response: QueryExecutionResult = {
      rows: result?.rows ?? [],
      fields:
        result?.fields.map((field: pg.FieldDef) => ({
          name: field.name,
          dataTypeID: field.dataTypeID
        })) ?? [],
      rowCount: result?.rowCount ?? null,
      command: result?.command ?? "QUERY",
      durationMs,
      notice: Array.isArray(rawResult) ? `${rawResult.length} statements executed.` : undefined
    };

    await this.store.addHistory(this.createHistoryItem(profileId, sql, response));
    return response;
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    const pool = this.getPool(input.profileId);
    const statement = buildInsertSql(this.engine, input.schema, input.table, input.values);
    const startedAt = performance.now();
    const result = await pool.query(statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.rowCount,
          command: result.command,
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "insert" } }
      )
    );
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    const pool = this.getPool(input.profileId);
    const statement = buildUpdateSql(this.engine, input.schema, input.table, input.key, input.values);
    const startedAt = performance.now();
    const result = await pool.query(statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.rowCount,
          command: result.command,
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "update" } }
      )
    );
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    const pool = this.getPool(input.profileId);
    const statement = buildDeleteSql(this.engine, input.schema, input.table, input.key);
    const startedAt = performance.now();
    const result = await pool.query(statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.rowCount,
          command: result.command,
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "delete" } }
      )
    );
  }

  async backupDatabase(
    profileId: string,
    backupDirectory: string,
    password?: string,
    options: DatabaseBackupOptions = {}
  ): Promise<DatabaseBackupResult> {
    const taskId = options.taskId ?? randomUUID();
    const progress = (
      phase: DatabaseBackupProgress["phase"],
      message?: string,
      extra?: Pick<DatabaseBackupProgress, "table" | "tablesDone" | "tablesTotal">
    ): void => {
      options.onProgress?.({ taskId, phase, message, ...extra });
    };
    const profile = await this.getProfileWithPassword(profileId, password);
    const filePath = join(backupDirectory, createBackupFileName(profile));

    progress("preparing", "Connecting to database...");
    const { client, dispose } = await this.createConnectedClient(profile);

    try {
      await createSqlDump(client, filePath, {
        signal: options.signal,
        onProgress: (update) => {
          if (update.phase === "data") {
            progress("data", update.table ? `Exporting ${update.table}...` : "Exporting data...", {
              table: update.table,
              tablesDone: update.tablesDone,
              tablesTotal: update.tablesTotal
            });
            return;
          }
          progress(
            "schema",
            update.phase === "finalizing" ? "Writing constraints and indexes..." : "Exporting schema..."
          );
        }
      });
      progress("done", "Backup saved.");
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => {});
      progress(
        options.signal?.aborted ? "cancelled" : "failed",
        options.signal?.aborted ? "Backup cancelled." : errorMessage(error)
      );
      throw error;
    } finally {
      await dispose();
    }

    return { filePath, taskId };
  }

  async restoreDatabase(
    profileId: string,
    filePath: string,
    password?: string,
    options: DatabaseRestoreOptions = {}
  ): Promise<DatabaseRestoreResult> {
    const taskId = options.taskId ?? randomUUID();
    const progress = (
      phase: DatabaseRestoreProgress["phase"],
      message?: string,
      extra?: Pick<DatabaseRestoreProgress, "table" | "statementsDone">
    ): void => {
      options.onProgress?.({ taskId, phase, message, ...extra });
    };
    const profile = await this.getProfileWithPassword(profileId, password);
    const extension = extname(filePath).toLowerCase();

    if (extension === ".dump" || extension === ".backup" || (await isCustomFormatDump(filePath))) {
      throw new Error(
        "This file is a custom-format PostgreSQL archive (pg_dump -Fc). XDB restores plain .sql backups only — restore this file with pg_restore, or create backups with XDB instead."
      );
    }

    progress("preparing", "Connecting to database...");
    const { client, dispose } = await this.createConnectedClient(profile);

    try {
      await restoreSqlFile(client, filePath, {
        signal: options.signal,
        onProgress: (update) => {
          if (update.phase === "copying-data") {
            progress("copying-data", update.table ? `Loading ${update.table}...` : "Loading data...", {
              table: update.table,
              statementsDone: update.statementsDone
            });
            return;
          }
          progress("executing", `Executed ${update.statementsDone ?? 0} statements...`, {
            statementsDone: update.statementsDone
          });
        }
      });
      progress("done", "Restore complete.");
    } catch (error) {
      progress(
        options.signal?.aborted ? "cancelled" : "failed",
        options.signal?.aborted ? "Restore cancelled." : errorMessage(error)
      );
      throw error;
    } finally {
      await dispose();
    }

    return { filePath, taskId };
  }

  private async createConnectedClient(
    profile: ConnectionProfile & { password: string }
  ): Promise<{ client: pg.PoolClient; dispose: () => Promise<void> }> {
    const { pool } = await this.createConnectedPool(profile);

    try {
      const client = await pool.connect();
      return {
        client,
        // Destroy the client instead of releasing it: an aborted COPY can
        // leave the connection in an unusable protocol state.
        dispose: async () => {
          client.release(true);
          await closePoolQuietly(pool);
        }
      };
    } catch (error) {
      await closePoolQuietly(pool);
      throw error;
    }
  }

  private async getProfileWithPassword(
    profileId: string,
    password?: string
  ): Promise<ConnectionProfile & { password: string }> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }

    return {
      ...profile,
      password: password ?? profile.password ?? ""
    };
  }

  private getPool(profileId: string): pg.Pool {
    const entry = this.pools.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry.pool;
  }

  private async readConnectionStatus(pool: pg.Pool, profile: ConnectionProfile): Promise<ConnectionStatus> {
    const result = await pool.query<{
      database: string;
      server_version: string;
      current_user: string;
    }>("select current_database() as database, current_setting('server_version') as server_version, current_user");
    const row = result.rows[0];

    return {
      profileId: profile.id,
      engine: this.engine,
      connected: true,
      database: row.database,
      serverVersion: row.server_version,
      currentUser: row.current_user
    };
  }

  private async createConnectedPool(profile: ConnectionProfile & { password: string }): Promise<ConnectedPool> {
    if (profile.sslMode === "require") {
      return this.openPool(profile, "require");
    }

    if (profile.sslMode === "disable") {
      try {
        return await this.openPool(profile, "disable");
      } catch (error) {
        if (!isSslRequiredError(error)) {
          throw error;
        }
      }

      const updatedProfile = await this.updateProfileSslMode(profile, "require");
      return this.openPool(updatedProfile, "require");
    }

    try {
      return await this.openPool(profile, "require");
    } catch (error) {
      if (!isServerSslUnsupportedError(error)) {
        throw error;
      }
    }

    return this.openPool(profile, "disable");
  }

  private async openPool(
    profile: ConnectionProfile & { password: string },
    sslMode: ConcreteSslMode
  ): Promise<ConnectedPool> {
    const pool = new Pool(this.toPgConfig(profile, sslMode));

    try {
      const status = await this.readConnectionStatus(pool, profile);
      return { pool, profile, status };
    } catch (error) {
      await closePoolQuietly(pool);
      throw createConnectionError(error, profile);
    }
  }

  private async updateProfileSslMode(
    profile: ConnectionProfile & { password: string },
    sslMode: ConnectionProfile["sslMode"]
  ): Promise<ConnectionProfile & { password: string }> {
    const updatedProfile = await this.store.saveConnection({
      id: profile.id,
      engine: profile.engine,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      database: profile.database,
      filePath: profile.filePath,
      user: profile.user,
      password: profile.password,
      sslMode,
      color: profile.color,
      savePassword: profile.savePassword
    });

    return {
      ...updatedProfile,
      password: profile.password
    };
  }

  private toPgConfig(profile: ConnectionProfile & { password: string }, sslMode: ConcreteSslMode): pg.PoolConfig {
    return {
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: profile.password,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: sslMode === "require" ? { rejectUnauthorized: false } : false
    };
  }

  private async getColumns(pool: pg.Pool, schema: string, table: string): Promise<TableColumn[]> {
    const result = await pool.query<{
      name: string;
      data_type: string;
      enum_values: string[] | null;
      is_nullable: "YES" | "NO";
      column_default: string | null;
      ordinal_position: number;
      character_maximum_length: number | null;
      numeric_precision: number | null;
    }>(
      `
        select
          c.column_name as name,
          case when c.data_type = 'USER-DEFINED' then c.udt_name else c.data_type end as data_type,
          coalesce(json_agg(e.enumlabel order by e.enumsortorder) filter (where e.enumlabel is not null), '[]'::json) as enum_values,
          c.is_nullable,
          c.column_default,
          c.ordinal_position,
          c.character_maximum_length,
          c.numeric_precision
        from information_schema.columns c
        left join pg_catalog.pg_namespace n on n.nspname = c.udt_schema
        left join pg_catalog.pg_type t on t.typnamespace = n.oid and t.typname = c.udt_name and t.typtype = 'e'
        left join pg_catalog.pg_enum e on e.enumtypid = t.oid
        where c.table_schema = $1 and c.table_name = $2
        group by
          c.column_name,
          c.data_type,
          c.udt_name,
          c.is_nullable,
          c.column_default,
          c.ordinal_position,
          c.character_maximum_length,
          c.numeric_precision
        order by c.ordinal_position
      `,
      [schema, table]
    );

    return result.rows.map((row) => ({
      name: row.name,
      dataType: row.data_type,
      enumValues: normalizeEnumValues(row.enum_values),
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default,
      ordinalPosition: Number(row.ordinal_position),
      maxLength: row.character_maximum_length === null ? null : Number(row.character_maximum_length),
      numericPrecision: row.numeric_precision === null ? null : Number(row.numeric_precision),
      isPrimaryKey: false
    }));
  }

  private async getIndexes(pool: pg.Pool, schema: string, table: string): Promise<TableIndex[]> {
    const result = await pool.query<{
      name: string;
      definition: string;
      is_primary: boolean;
      is_unique: boolean;
    }>(
      `
        select
          i.relname as name,
          pg_get_indexdef(i.oid) as definition,
          ix.indisprimary as is_primary,
          ix.indisunique as is_unique
        from pg_class t
        join pg_namespace n on n.oid = t.relnamespace
        join pg_index ix on ix.indrelid = t.oid
        join pg_class i on i.oid = ix.indexrelid
        where n.nspname = $1 and t.relname = $2
        order by ix.indisprimary desc, ix.indisunique desc, i.relname
      `,
      [schema, table]
    );

    return result.rows.map((row) => ({
      name: row.name,
      definition: row.definition,
      isPrimary: row.is_primary,
      isUnique: row.is_unique
    }));
  }

  private async getPrimaryKeys(pool: pg.Pool, schema: string, table: string): Promise<string[]> {
    const result = await pool.query<{ column_name: string }>(
      `
        select kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
         and tc.table_name = kcu.table_name
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = $1
          and tc.table_name = $2
        order by kcu.ordinal_position
      `,
      [schema, table]
    );

    return result.rows.map((row) => row.column_name);
  }

  private createHistoryItem(
    profileId: string,
    sql: string,
    response: QueryExecutionResult,
    options: HistoryItemOptions = {}
  ): QueryHistoryItem {
    const entry = this.pools.get(profileId);

    return {
      id: randomUUID(),
      profileId,
      engine: this.engine,
      database: entry?.profile.database ?? "",
      sql,
      durationMs: response.durationMs,
      rowCount: response.rowCount,
      command: response.command,
      createdAt: new Date().toISOString(),
      source: options.source ?? "query-editor",
      target: options.target
    };
  }
}

type MysqlPoolEntry = {
  pool: mysql.Pool;
  profile: ConnectionProfile & { password: string };
};

export class MysqlService implements DatabaseAdapter {
  readonly engine = "mysql" as const;
  private readonly pools = new Map<string, MysqlPoolEntry>();

  constructor(private readonly store: AppStore) {}

  async connect(profileId: string, password?: string): Promise<ConnectionStatus> {
    const profile = await this.getProfileWithPassword(profileId, password);
    const previous = this.pools.get(profileId);

    if (previous) {
      await previous.pool.end();
      this.pools.delete(profileId);
    }

    const { pool, status } = await this.createConnectedPool(profile);
    this.pools.set(profileId, { pool, profile });
    return status;
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.pools.get(profileId);
    if (!entry) {
      return;
    }

    await entry.pool.end();
    this.pools.delete(profileId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map((entry) => entry.pool.end()));
    this.pools.clear();
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    const { pool, profile } = this.getEntry(profileId);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `
        select
          table_schema as \`schema\`,
          table_name as name,
          table_type,
          table_rows as estimated_rows
        from information_schema.tables
        where table_schema = ?
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_schema, table_type, table_name
      `,
      [profile.database]
    );

    return rows.map((row) => ({
      schema: String(row.schema),
      name: String(row.name),
      type: row.table_type === "VIEW" ? "view" : "base_table",
      estimatedRows: row.estimated_rows === null || row.estimated_rows === undefined ? null : Number(row.estimated_rows)
    }));
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    const { pool } = this.getEntry(profileId);
    const [columns, indexes, primaryKeys] = await Promise.all([
      this.getColumns(pool, schema, table),
      this.getIndexes(pool, schema, table),
      this.getPrimaryKeys(pool, schema, table)
    ]);

    return {
      schema,
      table,
      columns: columns.map((column) => ({
        ...column,
        isPrimaryKey: primaryKeys.includes(column.name)
      })),
      indexes,
      primaryKeys
    };
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(pageSize, 10), 500);
    const offset = (safePage - 1) * safePageSize;
    const { pool } = this.getEntry(profileId);
    const structure = await this.getTableStructure(profileId, schema, table);
    const countStatement = buildFilteredCountTableSql(this.engine, schema, table, structure.columns, filters);
    const rowsStatement = buildFilteredSelectTableSql(
      this.engine,
      schema,
      table,
      structure.columns,
      filters,
      safePageSize,
      offset,
      sort
    );
    const startedAt = performance.now();
    const [[countRow], [rows]] = await Promise.all([
      pool.query<mysql.RowDataPacket[]>(countStatement.sql, countStatement.params),
      pool.query<mysql.RowDataPacket[]>(rowsStatement.sql, rowsStatement.params)
    ]);
    const rowArray = rows.map((row) => ({ ...row }));
    const durationMs = Math.round(performance.now() - startedAt);

    await this.store.addHistory(
      this.createHistoryItem(
        profileId,
        formatSqlStatementForHistory(rowsStatement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: rowArray.length,
          command: "SELECT",
          durationMs
        },
        { source: "table-data", target: { schema, table, action: "select" } }
      )
    );

    return {
      schema,
      table,
      rows: rowArray,
      columns: structure.columns,
      primaryKeys: structure.primaryKeys,
      totalRows: Number(countRow[0]?.count ?? 0),
      page: safePage,
      pageSize: safePageSize
    };
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) {
      throw new Error("Query cannot be empty.");
    }

    const { pool } = this.getEntry(profileId);
    const startedAt = performance.now();
    const [rows, fields] = await pool.query(sql);
    const durationMs = Math.round(performance.now() - startedAt);
    const rowArray = Array.isArray(rows) ? (rows as mysql.RowDataPacket[]).map((row) => ({ ...row })) : [];
    const resultHeader = Array.isArray(rows) ? null : (rows as mysql.ResultSetHeader);
    const response: QueryExecutionResult = {
      rows: rowArray,
      fields: Array.isArray(fields)
        ? fields.map((field) => ({
            name: field.name,
            dataTypeID: field.columnType ?? 0
          }))
        : [],
      rowCount: resultHeader ? resultHeader.affectedRows : rowArray.length,
      command: readSqlCommand(sql),
      durationMs
    };

    await this.store.addHistory(this.createHistoryItem(profileId, sql, response));
    return response;
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    const { pool } = this.getEntry(input.profileId);
    const statement = buildInsertSql(this.engine, input.schema, input.table, input.values);
    const startedAt = performance.now();
    const [result] = await pool.query(statement.sql, statement.params);
    const resultHeader = result as mysql.ResultSetHeader;
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: resultHeader.affectedRows,
          command: "INSERT",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "insert" } }
      )
    );
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    const { pool } = this.getEntry(input.profileId);
    const statement = buildUpdateSql(this.engine, input.schema, input.table, input.key, input.values);
    const startedAt = performance.now();
    const [result] = await pool.query(statement.sql, statement.params);
    const resultHeader = result as mysql.ResultSetHeader;
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: resultHeader.affectedRows,
          command: "UPDATE",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "update" } }
      )
    );
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    const { pool } = this.getEntry(input.profileId);
    const statement = buildDeleteSql(this.engine, input.schema, input.table, input.key);
    const startedAt = performance.now();
    const [result] = await pool.query(statement.sql, statement.params);
    const resultHeader = result as mysql.ResultSetHeader;
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: resultHeader.affectedRows,
          command: "DELETE",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "delete" } }
      )
    );
  }

  private async getProfileWithPassword(
    profileId: string,
    password?: string
  ): Promise<ConnectionProfile & { password: string }> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }
    if (profile.engine !== this.engine) {
      throw new Error("Connection profile is not a MySQL connection.");
    }

    return {
      ...profile,
      password: password ?? profile.password ?? ""
    };
  }

  private getEntry(profileId: string): MysqlPoolEntry {
    const entry = this.pools.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry;
  }

  private async createConnectedPool(profile: ConnectionProfile & { password: string }): Promise<{
    pool: mysql.Pool;
    status: ConnectionStatus;
  }> {
    if (profile.sslMode === "require") {
      return this.openPool(profile, true);
    }

    if (profile.sslMode === "disable") {
      return this.openPool(profile, false);
    }

    try {
      return await this.openPool(profile, true);
    } catch {
      return this.openPool(profile, false);
    }
  }

  private async openPool(
    profile: ConnectionProfile & { password: string },
    ssl: boolean
  ): Promise<{ pool: mysql.Pool; status: ConnectionStatus }> {
    const pool = mysql.createPool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: profile.password,
      waitForConnections: true,
      connectionLimit: 8,
      idleTimeout: 30_000,
      connectTimeout: 8_000,
      ssl: ssl ? { rejectUnauthorized: false } : undefined
    });

    try {
      const status = await this.readConnectionStatus(pool, profile);
      return { pool, status };
    } catch (error) {
      await pool.end();
      throw createMysqlConnectionError(error, profile);
    }
  }

  private async readConnectionStatus(pool: mysql.Pool, profile: ConnectionProfile): Promise<ConnectionStatus> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "select database() as `database`, version() as server_version, current_user() as current_user"
    );
    const row = rows[0];

    return {
      profileId: profile.id,
      engine: this.engine,
      connected: true,
      database: String(row?.database ?? profile.database),
      serverVersion: String(row?.server_version ?? ""),
      currentUser: String(row?.current_user ?? profile.user)
    };
  }

  private async getColumns(pool: mysql.Pool, schema: string, table: string): Promise<TableColumn[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `
        select
          column_name as name,
          coalesce(column_type, data_type) as data_type,
          is_nullable,
          column_default,
          ordinal_position,
          character_maximum_length,
          numeric_precision
        from information_schema.columns
        where table_schema = ? and table_name = ?
        order by ordinal_position
      `,
      [schema, table]
    );

    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.data_type),
      enumValues: mysqlEnumValues(String(row.data_type)),
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default === null || row.column_default === undefined ? null : String(row.column_default),
      ordinalPosition: Number(row.ordinal_position),
      maxLength:
        row.character_maximum_length === null || row.character_maximum_length === undefined
          ? null
          : Number(row.character_maximum_length),
      numericPrecision:
        row.numeric_precision === null || row.numeric_precision === undefined ? null : Number(row.numeric_precision),
      isPrimaryKey: false
    }));
  }

  private async getIndexes(pool: mysql.Pool, schema: string, table: string): Promise<TableIndex[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `
        select index_name, non_unique, seq_in_index, column_name
        from information_schema.statistics
        where table_schema = ? and table_name = ?
        order by index_name = 'PRIMARY' desc, non_unique asc, index_name, seq_in_index
      `,
      [schema, table]
    );
    const indexes = new Map<string, { columns: string[]; nonUnique: number }>();

    for (const row of rows) {
      const name = String(row.index_name);
      const current = indexes.get(name) ?? { columns: [], nonUnique: Number(row.non_unique) };
      current.columns.push(String(row.column_name));
      indexes.set(name, current);
    }

    return [...indexes.entries()].map(([name, index]) => {
      const columns = index.columns.map((column) => quoteIdentifier(column, this.engine)).join(", ");
      const isPrimary = name === "PRIMARY";
      const isUnique = index.nonUnique === 0;
      return {
        name,
        definition: isPrimary
          ? `PRIMARY KEY (${columns})`
          : `${isUnique ? "UNIQUE " : ""}KEY ${quoteIdentifier(name, this.engine)} (${columns})`,
        isPrimary,
        isUnique
      };
    });
  }

  private async getPrimaryKeys(pool: mysql.Pool, schema: string, table: string): Promise<string[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `
        select kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
         and tc.table_name = kcu.table_name
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = ?
          and tc.table_name = ?
        order by kcu.ordinal_position
      `,
      [schema, table]
    );

    return rows.map((row) => String(row.column_name));
  }

  private createHistoryItem(
    profileId: string,
    sql: string,
    response: QueryExecutionResult,
    options: HistoryItemOptions = {}
  ): QueryHistoryItem {
    const entry = this.pools.get(profileId);

    return {
      id: randomUUID(),
      profileId,
      engine: this.engine,
      database: entry?.profile.database ?? "",
      sql,
      durationMs: response.durationMs,
      rowCount: response.rowCount,
      command: response.command,
      createdAt: new Date().toISOString(),
      source: options.source ?? "query-editor",
      target: options.target
    };
  }
}

type SqliteEntry = {
  db: Database.Database;
  profile: ConnectionProfile;
};

export class SqliteService implements DatabaseAdapter {
  readonly engine = "sqlite" as const;
  private readonly connections = new Map<string, SqliteEntry>();

  constructor(private readonly store: AppStore) {}

  async connect(profileId: string): Promise<ConnectionStatus> {
    const profile = await this.getProfile(profileId);
    const previous = this.connections.get(profileId);

    if (previous) {
      previous.db.close();
      this.connections.delete(profileId);
    }

    if (!profile.filePath) {
      throw new Error("SQLite database file path is required.");
    }

    const db = new Database(profile.filePath, { timeout: 10_000 });
    db.pragma("foreign_keys = ON");
    this.connections.set(profileId, { db, profile });
    return this.readConnectionStatus(db, profile);
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.connections.get(profileId);
    if (!entry) {
      return;
    }

    entry.db.close();
    this.connections.delete(profileId);
  }

  async closeAll(): Promise<void> {
    for (const entry of this.connections.values()) {
      entry.db.close();
    }
    this.connections.clear();
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    const { db } = this.getEntry(profileId);
    const rows = db
      .prepare(
        `
          select
            'main' as schema,
            name,
            type
          from sqlite_master
          where type in ('table', 'view')
            and name not like 'sqlite_%'
          order by type, name
        `
      )
      .all() as Array<{ schema: string; name: string; type: "table" | "view" }>;

    return rows.map((row) => ({
      schema: row.schema,
      name: row.name,
      type: row.type === "view" ? "view" : "base_table",
      estimatedRows: null
    }));
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    const { db } = this.getEntry(profileId);
    const columns = this.getColumns(db, table);
    const primaryKeys = columns
      .filter((column) => column.isPrimaryKey)
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((column) => column.name);

    return {
      schema,
      table,
      columns,
      indexes: this.getIndexes(db, table),
      primaryKeys
    };
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(pageSize, 10), 500);
    const offset = (safePage - 1) * safePageSize;
    const { db } = this.getEntry(profileId);
    const structure = await this.getTableStructure(profileId, schema, table);
    const countStatement = buildFilteredCountTableSql(this.engine, schema, table, structure.columns, filters);
    const rowsStatement = buildFilteredSelectTableSql(
      this.engine,
      schema,
      table,
      structure.columns,
      filters,
      safePageSize,
      offset,
      sort
    );
    const startedAt = performance.now();
    const countRow = db.prepare(countStatement.sql).get(...(countStatement.params as never[])) as
      | { count?: number }
      | undefined;
    const rows = db.prepare(rowsStatement.sql).all(...(rowsStatement.params as never[])) as Record<string, unknown>[];
    const durationMs = Math.round(performance.now() - startedAt);

    await this.store.addHistory(
      this.createHistoryItem(
        profileId,
        formatSqlStatementForHistory(rowsStatement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: rows.length,
          command: "SELECT",
          durationMs
        },
        { source: "table-data", target: { schema, table, action: "select" } }
      )
    );

    return {
      schema,
      table,
      rows,
      columns: structure.columns,
      primaryKeys: structure.primaryKeys,
      totalRows: Number(countRow?.count ?? 0),
      page: safePage,
      pageSize: safePageSize
    };
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) {
      throw new Error("Query cannot be empty.");
    }

    const { db } = this.getEntry(profileId);
    const startedAt = performance.now();
    const response = executeSqliteStatement(db, sql.trim(), startedAt);
    await this.store.addHistory(this.createHistoryItem(profileId, sql, response));
    return response;
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    const { db } = this.getEntry(input.profileId);
    const statement = buildInsertSql(this.engine, input.schema, input.table, input.values);
    const startedAt = performance.now();
    const result = db.prepare(statement.sql).run(...(statement.params as never[]));
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.changes,
          command: "INSERT",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "insert" } }
      )
    );
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    const { db } = this.getEntry(input.profileId);
    const statement = buildUpdateSql(this.engine, input.schema, input.table, input.key, input.values);
    const startedAt = performance.now();
    const result = db.prepare(statement.sql).run(...(statement.params as never[]));
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.changes,
          command: "UPDATE",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "update" } }
      )
    );
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    const { db } = this.getEntry(input.profileId);
    const statement = buildDeleteSql(this.engine, input.schema, input.table, input.key);
    const startedAt = performance.now();
    const result = db.prepare(statement.sql).run(...(statement.params as never[]));
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: result.changes,
          command: "DELETE",
          durationMs: Math.round(performance.now() - startedAt)
        },
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "delete" } }
      )
    );
  }

  private async getProfile(profileId: string): Promise<ConnectionProfile> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }
    if (profile.engine !== this.engine) {
      throw new Error("Connection profile is not a SQLite connection.");
    }

    return profile;
  }

  private getEntry(profileId: string): SqliteEntry {
    const entry = this.connections.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry;
  }

  private readConnectionStatus(db: Database.Database, profile: ConnectionProfile): ConnectionStatus {
    const version = db.prepare("select sqlite_version() as version").get() as { version: string };

    return {
      profileId: profile.id,
      engine: this.engine,
      connected: true,
      database: profile.filePath ? basename(profile.filePath) : profile.database,
      serverVersion: version.version,
      currentUser: undefined
    };
  }

  private getColumns(db: Database.Database, table: string): TableColumn[] {
    const rows = db.prepare(`pragma table_info(${quoteIdentifier(table, this.engine)})`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: 0 | 1;
      dflt_value: string | null;
      pk: number;
    }>;

    return rows.map((row) => ({
      name: row.name,
      dataType: row.type || "unknown",
      nullable: row.notnull === 0 && row.pk === 0,
      defaultValue: row.dflt_value,
      ordinalPosition: row.cid + 1,
      maxLength: null,
      numericPrecision: null,
      isPrimaryKey: row.pk > 0
    }));
  }

  private getIndexes(db: Database.Database, table: string): TableIndex[] {
    const rows = db.prepare(`pragma index_list(${quoteIdentifier(table, this.engine)})`).all() as Array<{
      name: string;
      unique: 0 | 1;
      origin: string;
    }>;

    return rows.map((row) => {
      const columns = (
        db.prepare(`pragma index_info(${quoteIdentifier(row.name, this.engine)})`).all() as Array<{ name: string }>
      ).map((column) => quoteIdentifier(column.name, this.engine));
      const isPrimary = row.origin === "pk";

      return {
        name: row.name,
        definition: `${isPrimary ? "PRIMARY KEY" : row.unique ? "UNIQUE INDEX" : "INDEX"} ${quoteIdentifier(
          row.name,
          this.engine
        )} (${columns.join(", ")})`,
        isPrimary,
        isUnique: row.unique === 1 || isPrimary
      };
    });
  }

  private createHistoryItem(
    profileId: string,
    sql: string,
    response: QueryExecutionResult,
    options: HistoryItemOptions = {}
  ): QueryHistoryItem {
    const entry = this.connections.get(profileId);

    return {
      id: randomUUID(),
      profileId,
      engine: this.engine,
      database: entry?.profile.database ?? "",
      sql,
      durationMs: response.durationMs,
      rowCount: response.rowCount,
      command: response.command,
      createdAt: new Date().toISOString(),
      source: options.source ?? "query-editor",
      target: options.target
    };
  }
}

type TursoEntry = {
  client: TursoClient;
  profile: ConnectionProfile & { password: string };
};

export class TursoService implements DatabaseAdapter {
  readonly engine = "turso" as const;
  private readonly connections = new Map<string, TursoEntry>();

  constructor(private readonly store: AppStore) {}

  async connect(profileId: string, password?: string): Promise<ConnectionStatus> {
    const profile = await this.getProfileWithPassword(profileId, password);
    const previous = this.connections.get(profileId);

    if (previous) {
      previous.client.close();
      this.connections.delete(profileId);
    }

    if (!profile.endpoint) {
      throw new Error("Turso database URL is required.");
    }

    const client = createClient({ url: profile.endpoint, authToken: profile.password });
    try {
      const status = await this.readConnectionStatus(client, profile);
      this.connections.set(profileId, { client, profile });
      return status;
    } catch (error) {
      client.close();
      throw createTursoConnectionError(error, profile);
    }
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.connections.get(profileId);
    if (!entry) {
      return;
    }

    entry.client.close();
    this.connections.delete(profileId);
  }

  async closeAll(): Promise<void> {
    for (const entry of this.connections.values()) {
      entry.client.close();
    }
    this.connections.clear();
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    const { client } = this.getEntry(profileId);
    const result = await client.execute(`
      select
        'main' as schema,
        name,
        case type when 'view' then 'view' else 'base_table' end as type
      from sqlite_schema
      where type in ('table', 'view')
        and name not like 'sqlite_%'
      order by type, name
    `);

    return tursoRowsToRecords(result).map((row) => ({
      schema: String(row.schema),
      name: String(row.name),
      type: row.type === "view" ? "view" : "base_table",
      estimatedRows: null
    }));
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    const { client } = this.getEntry(profileId);
    const columns = await this.getColumns(client, table);
    const primaryKeys = columns
      .filter((column) => column.isPrimaryKey)
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((column) => column.name);

    return {
      schema,
      table,
      columns,
      indexes: await this.getIndexes(client, table),
      primaryKeys
    };
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(pageSize, 10), 500);
    const offset = (safePage - 1) * safePageSize;
    const { client } = this.getEntry(profileId);
    const structure = await this.getTableStructure(profileId, schema, table);
    const countStatement = buildFilteredCountTableSql(this.engine, schema, table, structure.columns, filters);
    const rowsStatement = buildFilteredSelectTableSql(
      this.engine,
      schema,
      table,
      structure.columns,
      filters,
      safePageSize,
      offset,
      sort
    );
    const startedAt = performance.now();
    const [countResult, rowsResult] = await Promise.all([
      client.execute({ sql: countStatement.sql, args: countStatement.params as never[] }),
      client.execute({ sql: rowsStatement.sql, args: rowsStatement.params as never[] })
    ]);
    const [countRow] = tursoRowsToRecords(countResult);
    const rows = tursoRowsToRecords(rowsResult);
    const durationMs = Math.round(performance.now() - startedAt);

    await this.store.addHistory(
      this.createHistoryItem(
        profileId,
        formatSqlStatementForHistory(rowsStatement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: rows.length,
          command: "SELECT",
          durationMs
        },
        { source: "table-data", target: { schema, table, action: "select" } }
      )
    );

    return {
      schema,
      table,
      rows,
      columns: structure.columns,
      primaryKeys: structure.primaryKeys,
      totalRows: Number(countRow?.count ?? 0),
      page: safePage,
      pageSize: safePageSize
    };
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) {
      throw new Error("Query cannot be empty.");
    }

    const { client } = this.getEntry(profileId);
    const startedAt = performance.now();
    const result = await client.execute(sql);
    const response = createTursoQueryExecutionResult(result, sql, Math.round(performance.now() - startedAt));
    await this.store.addHistory(this.createHistoryItem(profileId, sql, response));
    return response;
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    const { client } = this.getEntry(input.profileId);
    const statement = buildInsertSql(this.engine, input.schema, input.table, input.values);
    const startedAt = performance.now();
    const result = await client.execute({ sql: statement.sql, args: statement.params as never[] });
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createTursoQueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "insert" } }
      )
    );
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    const { client } = this.getEntry(input.profileId);
    const statement = buildUpdateSql(this.engine, input.schema, input.table, input.key, input.values);
    const startedAt = performance.now();
    const result = await client.execute({ sql: statement.sql, args: statement.params as never[] });
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createTursoQueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "update" } }
      )
    );
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    const { client } = this.getEntry(input.profileId);
    const statement = buildDeleteSql(this.engine, input.schema, input.table, input.key);
    const startedAt = performance.now();
    const result = await client.execute({ sql: statement.sql, args: statement.params as never[] });
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createTursoQueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "delete" } }
      )
    );
  }

  private async getProfileWithPassword(
    profileId: string,
    password?: string
  ): Promise<ConnectionProfile & { password: string }> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }
    if (profile.engine !== this.engine) {
      throw new Error("Connection profile is not a Turso connection.");
    }

    const resolvedPassword = password ?? profile.password ?? "";
    if (!resolvedPassword) {
      throw new Error("This Turso connection requires an auth token. Enter the auth token and try again.");
    }

    return {
      ...profile,
      password: resolvedPassword
    };
  }

  private getEntry(profileId: string): TursoEntry {
    const entry = this.connections.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry;
  }

  private async readConnectionStatus(client: TursoClient, profile: ConnectionProfile): Promise<ConnectionStatus> {
    const result = await client.execute("select sqlite_version() as version");
    const [row] = tursoRowsToRecords(result);

    return {
      profileId: profile.id,
      engine: this.engine,
      connected: true,
      database: profile.database || profile.endpoint,
      serverVersion: String(row?.version ?? ""),
      currentUser: undefined
    };
  }

  private async getColumns(client: TursoClient, table: string): Promise<TableColumn[]> {
    const result = await client.execute(`pragma table_info(${quoteIdentifier(table, this.engine)})`);

    return tursoRowsToRecords(result).map(sqlitePragmaColumnToTableColumn);
  }

  private async getIndexes(client: TursoClient, table: string): Promise<TableIndex[]> {
    const result = await client.execute(`pragma index_list(${quoteIdentifier(table, this.engine)})`);
    const indexes: TableIndex[] = [];

    for (const row of tursoRowsToRecords(result)) {
      const name = String(row.name);
      const columnsResult = await client.execute(`pragma index_info(${quoteIdentifier(name, this.engine)})`);
      indexes.push(sqlitePragmaIndexToTableIndex(row, tursoRowsToRecords(columnsResult), this.engine));
    }

    return indexes;
  }

  private createHistoryItem(
    profileId: string,
    sql: string,
    response: QueryExecutionResult,
    options: HistoryItemOptions = {}
  ): QueryHistoryItem {
    const entry = this.connections.get(profileId);

    return {
      id: randomUUID(),
      profileId,
      engine: this.engine,
      database: entry?.profile.database ?? "",
      sql,
      durationMs: response.durationMs,
      rowCount: response.rowCount,
      command: response.command,
      createdAt: new Date().toISOString(),
      source: options.source ?? "query-editor",
      target: options.target
    };
  }
}

type D1Entry = {
  profile: ConnectionProfile & { password: string };
};

type D1ApiResponseInfo = {
  code?: number;
  message?: string;
};

type D1ApiQueryResult = {
  meta?: {
    changes?: number;
    duration?: number;
    timings?: {
      sql_duration_ms?: number;
    };
  };
  results?: Record<string, unknown>[];
  success?: boolean;
  error?: string;
};

type D1ApiEnvelope = {
  success?: boolean;
  errors?: D1ApiResponseInfo[];
  messages?: D1ApiResponseInfo[];
  result?: D1ApiQueryResult[];
};

export class CloudflareD1Service implements DatabaseAdapter {
  readonly engine = "cloudflare-d1" as const;
  private readonly connections = new Map<string, D1Entry>();

  constructor(private readonly store: AppStore) {}

  async connect(profileId: string, password?: string): Promise<ConnectionStatus> {
    const profile = await this.getProfileWithPassword(profileId, password);
    await this.disconnect(profileId);
    await executeCloudflareD1Query(profile, "select 1 as ok");

    this.connections.set(profileId, { profile });
    return {
      profileId,
      engine: this.engine,
      connected: true,
      database: profile.database || profile.databaseId,
      serverVersion: "D1",
      currentUser: undefined
    };
  }

  async disconnect(profileId: string): Promise<void> {
    this.connections.delete(profileId);
  }

  async closeAll(): Promise<void> {
    this.connections.clear();
  }

  async listObjects(profileId: string): Promise<DatabaseObject[]> {
    const { profile } = this.getEntry(profileId);
    const result = await executeCloudflareD1Query(
      profile,
      `
        select
          'main' as schema,
          name,
          case type when 'view' then 'view' else 'base_table' end as type
        from sqlite_schema
        where type in ('table', 'view')
          and name not like 'sqlite_%'
        order by type, name
      `
    );

    return (result.results ?? []).map((row) => ({
      schema: String(row.schema),
      name: String(row.name),
      type: row.type === "view" ? "view" : "base_table",
      estimatedRows: null
    }));
  }

  async getTableStructure(profileId: string, schema: string, table: string): Promise<TableStructure> {
    const { profile } = this.getEntry(profileId);
    const columns = await this.getColumns(profile, table);
    const primaryKeys = columns
      .filter((column) => column.isPrimaryKey)
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((column) => column.name);

    return {
      schema,
      table,
      columns,
      indexes: await this.getIndexes(profile, table),
      primaryKeys
    };
  }

  async getTableData(
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ): Promise<TableDataResult> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(pageSize, 10), 500);
    const offset = (safePage - 1) * safePageSize;
    const { profile } = this.getEntry(profileId);
    const structure = await this.getTableStructure(profileId, schema, table);
    const countStatement = buildFilteredCountTableSql(this.engine, schema, table, structure.columns, filters);
    const rowsStatement = buildFilteredSelectTableSql(
      this.engine,
      schema,
      table,
      structure.columns,
      filters,
      safePageSize,
      offset,
      sort
    );
    const startedAt = performance.now();
    const [countResult, rowsResult] = await Promise.all([
      executeCloudflareD1Query(profile, countStatement.sql, countStatement.params),
      executeCloudflareD1Query(profile, rowsStatement.sql, rowsStatement.params)
    ]);
    const [countRow] = countResult.results ?? [];
    const rows = rowsResult.results ?? [];
    const durationMs = d1DurationMs(rowsResult) ?? Math.round(performance.now() - startedAt);

    await this.store.addHistory(
      this.createHistoryItem(
        profileId,
        formatSqlStatementForHistory(rowsStatement, this.engine),
        {
          rows: [],
          fields: [],
          rowCount: rows.length,
          command: "SELECT",
          durationMs
        },
        { source: "table-data", target: { schema, table, action: "select" } }
      )
    );

    return {
      schema,
      table,
      rows,
      columns: structure.columns,
      primaryKeys: structure.primaryKeys,
      totalRows: Number(countRow?.count ?? 0),
      page: safePage,
      pageSize: safePageSize
    };
  }

  async executeQuery(profileId: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) {
      throw new Error("Query cannot be empty.");
    }

    const { profile } = this.getEntry(profileId);
    const startedAt = performance.now();
    const result = await executeCloudflareD1Query(profile, sql);
    const response = createD1QueryExecutionResult(result, sql, Math.round(performance.now() - startedAt));
    await this.store.addHistory(this.createHistoryItem(profileId, sql, response));
    return response;
  }

  async insertRow(input: UpsertRowInput): Promise<void> {
    const { profile } = this.getEntry(input.profileId);
    const statement = buildInsertSql(this.engine, input.schema, input.table, input.values);
    const startedAt = performance.now();
    const result = await executeCloudflareD1Query(profile, statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createD1QueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "insert" } }
      )
    );
  }

  async updateRow(input: UpdateRowInput): Promise<void> {
    const { profile } = this.getEntry(input.profileId);
    const statement = buildUpdateSql(this.engine, input.schema, input.table, input.key, input.values);
    const startedAt = performance.now();
    const result = await executeCloudflareD1Query(profile, statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createD1QueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "update" } }
      )
    );
  }

  async deleteRow(input: DeleteRowInput): Promise<void> {
    const { profile } = this.getEntry(input.profileId);
    const statement = buildDeleteSql(this.engine, input.schema, input.table, input.key);
    const startedAt = performance.now();
    const result = await executeCloudflareD1Query(profile, statement.sql, statement.params);
    await this.store.addHistory(
      this.createHistoryItem(
        input.profileId,
        formatSqlStatementForHistory(statement, this.engine),
        createD1QueryExecutionResult(result, statement.sql, Math.round(performance.now() - startedAt)),
        { source: "row-edit", target: { schema: input.schema, table: input.table, action: "delete" } }
      )
    );
  }

  private async getProfileWithPassword(
    profileId: string,
    password?: string
  ): Promise<ConnectionProfile & { password: string }> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }
    if (profile.engine !== this.engine) {
      throw new Error("Connection profile is not a Cloudflare D1 connection.");
    }
    if (!profile.accountId) {
      throw new Error("Cloudflare D1 account ID is required.");
    }
    if (!profile.databaseId) {
      throw new Error("Cloudflare D1 database ID is required.");
    }

    const resolvedPassword = password ?? profile.password ?? "";
    if (!resolvedPassword) {
      throw new Error("This Cloudflare D1 connection requires an API token. Enter the API token and try again.");
    }

    return {
      ...profile,
      password: resolvedPassword
    };
  }

  private getEntry(profileId: string): D1Entry {
    const entry = this.connections.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry;
  }

  private async getColumns(profile: ConnectionProfile & { password: string }, table: string): Promise<TableColumn[]> {
    const result = await executeCloudflareD1Query(profile, `pragma table_info(${quoteIdentifier(table, this.engine)})`);
    return (result.results ?? []).map(sqlitePragmaColumnToTableColumn);
  }

  private async getIndexes(profile: ConnectionProfile & { password: string }, table: string): Promise<TableIndex[]> {
    const result = await executeCloudflareD1Query(profile, `pragma index_list(${quoteIdentifier(table, this.engine)})`);
    const indexes: TableIndex[] = [];

    for (const row of result.results ?? []) {
      const name = String(row.name);
      const columnsResult = await executeCloudflareD1Query(
        profile,
        `pragma index_info(${quoteIdentifier(name, this.engine)})`
      );
      indexes.push(sqlitePragmaIndexToTableIndex(row, columnsResult.results ?? [], this.engine));
    }

    return indexes;
  }

  private createHistoryItem(
    profileId: string,
    sql: string,
    response: QueryExecutionResult,
    options: HistoryItemOptions = {}
  ): QueryHistoryItem {
    const entry = this.connections.get(profileId);

    return {
      id: randomUUID(),
      profileId,
      engine: this.engine,
      database: entry?.profile.database ?? "",
      sql,
      durationMs: response.durationMs,
      rowCount: response.rowCount,
      command: response.command,
      createdAt: new Date().toISOString(),
      source: options.source ?? "query-editor",
      target: options.target
    };
  }
}

async function closePoolQuietly(pool: pg.Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // The original connection failure is more useful than a cleanup error.
  }
}

function createConnectionError(error: unknown, profile: ConnectionProfile & { password?: string }): Error {
  if (isInsecureConnectionError(error) && profile.sslMode !== "require") {
    return new Error(
      "This server requires SSL. Edit the connection and set SSL to Require, or add sslmode=require to the connection URL."
    );
  }

  if (isMissingPasswordError(error)) {
    return new Error("This connection requires a password. Enter the database password and try again.");
  }

  if (isPasswordAuthenticationError(error) && !profile.password) {
    return new Error("This connection requires a password. Enter the database password and try again.");
  }

  if (isPasswordAuthenticationError(error)) {
    return new Error("Postgres rejected the password for this user. Check the password and try again.");
  }

  return error instanceof Error ? error : new Error(String(error));
}

function createMysqlConnectionError(error: unknown, profile: ConnectionProfile & { password?: string }): Error {
  if (isAccessDeniedError(error) && !profile.password) {
    return new Error("This connection requires a password. Enter the database password and try again.");
  }

  if (isAccessDeniedError(error)) {
    return new Error("MySQL rejected the credentials for this user. Check the user/password and try again.");
  }

  return error instanceof Error ? error : new Error(String(error));
}

function createTursoConnectionError(error: unknown, profile: ConnectionProfile & { password?: string }): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (!profile.password && /auth|token|unauthorized/i.test(message)) {
    return new Error("This Turso connection requires an auth token. Enter the auth token and try again.");
  }

  if (/auth|token|unauthorized/i.test(message)) {
    return new Error("Turso rejected the auth token. Check the token and try again.");
  }

  return error instanceof Error ? error : new Error(String(error));
}

function executeSqliteStatement(db: Database.Database, sql: string, startedAt: number): QueryExecutionResult {
  try {
    const statement = db.prepare(sql);
    if (statement.reader) {
      const rows = statement.all() as Record<string, unknown>[];
      const durationMs = Math.round(performance.now() - startedAt);
      return {
        rows,
        fields: statement.columns().map((column) => ({
          name: column.name,
          dataTypeID: 0
        })),
        rowCount: rows.length,
        command: readSqlCommand(sql),
        durationMs
      };
    }

    const result = statement.run();
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      rows: [],
      fields: [],
      rowCount: result.changes,
      command: readSqlCommand(sql),
      durationMs
    };
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("contains more than one statement")) {
      db.exec(sql);
      return {
        rows: [],
        fields: [],
        rowCount: null,
        command: "SCRIPT",
        durationMs: Math.round(performance.now() - startedAt),
        notice: "Multiple statements executed."
      };
    }

    throw error;
  }
}

export function createTursoQueryExecutionResult(
  result: TursoResultSet,
  sql: string,
  durationMs: number
): QueryExecutionResult {
  const rows = tursoRowsToRecords(result);

  return {
    rows,
    fields: result.columns.map((name, index) => ({
      name,
      dataTypeID: tursoColumnTypeId(result.columnTypes[index])
    })),
    rowCount: rows.length > 0 ? rows.length : result.rowsAffected,
    command: readSqlCommand(sql),
    durationMs
  };
}

export function createD1QueryExecutionResult(
  result: D1ApiQueryResult,
  sql: string,
  fallbackDurationMs: number
): QueryExecutionResult {
  const rows = result.results ?? [];

  return {
    rows,
    fields: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      dataTypeID: 0
    })),
    rowCount: rows.length > 0 ? rows.length : (result.meta?.changes ?? null),
    command: readSqlCommand(sql),
    durationMs: d1DurationMs(result) ?? fallbackDurationMs
  };
}

export async function executeCloudflareD1Query(
  profile: ConnectionProfile & { password: string },
  sql: string,
  params: unknown[] = []
): Promise<D1ApiQueryResult> {
  if (!profile.accountId) {
    throw new Error("Cloudflare D1 account ID is required.");
  }
  if (!profile.databaseId) {
    throw new Error("Cloudflare D1 database ID is required.");
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(profile.accountId)}/d1/database/${encodeURIComponent(
      profile.databaseId
    )}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.password}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params.length ? { sql, params } : { sql })
    }
  );
  const body = await readD1ResponseBody(response);

  if (!response.ok) {
    throw new Error(readD1ApiMessage(body) ?? `Cloudflare D1 request failed with HTTP ${response.status}.`);
  }

  if (body.success === false) {
    throw new Error(readD1ApiMessage(body) ?? "Cloudflare D1 rejected the request.");
  }

  const result = body.result?.at(-1);
  if (!result) {
    throw new Error("Cloudflare D1 returned no query result.");
  }

  if (result.success === false) {
    throw new Error(result.error ?? readD1ApiMessage(body) ?? "Cloudflare D1 query failed.");
  }

  return result;
}

function tursoRowsToRecords(result: TursoResultSet): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of result.columns) {
      record[column] = row[column];
    }
    return record;
  });
}

function tursoColumnTypeId(columnType: string | undefined): number {
  switch (columnType?.toLowerCase()) {
    case "integer":
      return 1;
    case "real":
    case "float":
      return 2;
    case "text":
      return 3;
    case "blob":
      return 4;
    case "null":
      return 5;
    default:
      return 0;
  }
}

function sqlitePragmaColumnToTableColumn(row: Record<string, unknown>): TableColumn {
  const primaryKeyPosition = Number(row.pk ?? 0);

  return {
    name: String(row.name),
    dataType: String(row.type || "unknown"),
    nullable: Number(row.notnull ?? 0) === 0 && primaryKeyPosition === 0,
    defaultValue: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
    ordinalPosition: Number(row.cid ?? 0) + 1,
    maxLength: null,
    numericPrecision: null,
    isPrimaryKey: primaryKeyPosition > 0
  };
}

function mysqlEnumValues(dataType: string): string[] | undefined {
  if (!dataType.toLowerCase().startsWith("enum(")) {
    return undefined;
  }

  const values: string[] = [];
  const source = dataType.slice(5, -1);
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === ",") {
      values.push(current);
      current = "";
    }
  }

  values.push(current);
  return values.length ? values : undefined;
}

function normalizeEnumValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.map((item) => String(item));
  return values.length ? values : undefined;
}

function sqlitePragmaIndexToTableIndex(
  row: Record<string, unknown>,
  columnRows: Record<string, unknown>[],
  dialect: DatabaseEngine
): TableIndex {
  const name = String(row.name);
  const isPrimary = row.origin === "pk";
  const isUnique = Number(row.unique ?? 0) === 1 || isPrimary;
  const columns = columnRows.map((column) => quoteIdentifier(String(column.name), dialect)).join(", ");

  return {
    name,
    definition: `${isPrimary ? "PRIMARY KEY" : isUnique ? "UNIQUE INDEX" : "INDEX"} ${quoteIdentifier(
      name,
      dialect
    )} (${columns})`,
    isPrimary,
    isUnique
  };
}

async function readD1ResponseBody(response: Response): Promise<D1ApiEnvelope> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as D1ApiEnvelope;
  } catch {
    return {
      success: false,
      errors: [{ message: text }]
    };
  }
}

function readD1ApiMessage(body: D1ApiEnvelope): string | null {
  const messages = [...(body.errors ?? []), ...(body.messages ?? [])]
    .map((item) => item.message)
    .filter((message): message is string => Boolean(message));
  return messages[0] ?? null;
}

function d1DurationMs(result: D1ApiQueryResult): number | null {
  if (typeof result.meta?.timings?.sql_duration_ms === "number") {
    return Math.round(result.meta.timings.sql_duration_ms);
  }

  if (typeof result.meta?.duration === "number") {
    return Math.round(result.meta.duration);
  }

  return null;
}

function readSqlCommand(sql: string): string {
  return (
    sql
      .trim()
      .match(/^[A-Za-z]+/)?.[0]
      ?.toUpperCase() ?? "QUERY"
  );
}

function isInsecureConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("connection is insecure");
}

function isSslRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isInsecureConnectionError(error) || message.toLowerCase().includes("server requires ssl");
}

function isServerSslUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("does not support ssl");
}

function isMissingPasswordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("client password must be a string");
}

function isPasswordAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("password authentication failed");
}

function isAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("access denied");
}

function createBackupFileName(profile: ConnectionProfile): string {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:.]/g, "-");
  const baseName = sanitizeFilePart(`${profile.name || profile.database}-${profile.database}`);
  return `${baseName}-${stamp}.sql`;
}

function sanitizeFilePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "postgres-backup"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

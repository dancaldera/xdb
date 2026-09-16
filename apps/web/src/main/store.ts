import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createConnectionArchive, createConnectionArchiveCopies } from "../shared/connection-archive";
import { parseConnectionPickerLayout } from "../shared/connection-picker-layout";
import type {
  AppSettings,
  AppSettingsInput,
  ConnectionArchive,
  ConnectionEngine,
  ConnectionGroup,
  ConnectionGroupInput,
  ConnectionInput,
  ConnectionKind,
  ConnectionPickerLayout,
  ConnectionProfile,
  QueryHistoryItem,
  SavedSqlQuery,
  SavedSqlQueryInput,
  SqlEditorDraft
} from "../shared/types";

type StoredConnection = Omit<ConnectionProfile, "hasPassword" | "kind" | "engine"> & {
  kind?: ConnectionKind;
  engine?: ConnectionEngine;
  encryptedPassword?: string;
};

type PersistedState = {
  connections: StoredConnection[];
  groups: ConnectionGroup[];
  history: QueryHistoryItem[];
  savedQueries: SavedSqlQuery[];
  sqlDrafts: Record<string, SqlEditorDraft>;
  settings?: AppSettings;
  connectionPickerLayout?: ConnectionPickerLayout;
};

const DEFAULT_STATE: PersistedState = {
  connections: [],
  groups: [],
  history: [],
  savedQueries: [],
  sqlDrafts: {},
  settings: {
    theme: "system"
  }
};

export function defaultDataDir(): string {
  return process.env.XDB_DATA_DIR ?? join(homedir(), ".xdb");
}

export class AppStore {
  private readonly filePath: string;
  private historyQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string = defaultDataDir()) {
    this.filePath = join(dataDir, "xdb-state.json");
  }

  async listConnections(): Promise<ConnectionProfile[]> {
    const state = await this.read();
    return state.connections.map((connection) => this.toPublicConnection(connection));
  }

  async saveConnection(input: ConnectionInput): Promise<ConnectionProfile> {
    const state = await this.read();
    const now = new Date().toISOString();
    const existing = input.id ? state.connections.find((connection) => connection.id === input.id) : undefined;
    const stored = this.toStoredConnection(input, existing, now);

    state.connections = existing
      ? state.connections.map((connection) => (connection.id === stored.id ? stored : connection))
      : [stored, ...state.connections];

    await this.write(state);
    return this.toPublicConnection(stored);
  }

  async deleteConnection(profileId: string): Promise<void> {
    const state = await this.read();
    state.connections = state.connections.filter((connection) => connection.id !== profileId);
    state.savedQueries = state.savedQueries.filter((query) => query.profileId !== profileId);
    const { [profileId]: _deletedDraft, ...sqlDrafts } = state.sqlDrafts;
    state.sqlDrafts = sqlDrafts;
    await this.write(state);
  }

  async exportConnectionArchive(includeSecrets: boolean): Promise<ConnectionArchive> {
    const state = await this.read();
    return createConnectionArchive({
      includeSecrets,
      groups: state.groups,
      connections: state.connections.map((connection) => this.toPublicConnection(connection))
    });
  }

  async importConnectionArchive(value: unknown): Promise<{ groups: number; connections: number }> {
    const state = await this.read();
    const now = new Date().toISOString();
    const copies = createConnectionArchiveCopies(value, { now });

    state.groups = [...state.groups, ...copies.groups];
    state.connections = [
      ...copies.connections.map((connection) => this.toStoredConnection(connection, undefined, now)),
      ...state.connections
    ];

    await this.write(state);
    return {
      groups: copies.groups.length,
      connections: copies.connections.length
    };
  }

  async getConnection(profileId: string): Promise<(ConnectionProfile & { password?: string }) | null> {
    const state = await this.read();
    const connection = state.connections.find((item) => item.id === profileId);

    if (!connection) {
      return null;
    }

    return {
      ...this.toPublicConnection(connection),
      password: connection.password ?? this.decryptPassword(connection.encryptedPassword)
    };
  }

  async listConnectionGroups(): Promise<ConnectionGroup[]> {
    const state = await this.read();
    return state.groups;
  }

  async saveConnectionGroup(input: ConnectionGroupInput): Promise<ConnectionGroup> {
    const state = await this.read();
    const now = new Date().toISOString();
    const existing = input.id ? state.groups.find((group) => group.id === input.id) : undefined;
    const group: ConnectionGroup = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      color: input.color,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (!group.name) {
      throw new Error("Group name is required.");
    }

    state.groups = existing
      ? state.groups.map((item) => (item.id === group.id ? group : item))
      : [...state.groups, group];

    await this.write(state);
    return group;
  }

  async deleteConnectionGroup(groupId: string): Promise<void> {
    const state = await this.read();
    state.groups = state.groups.filter((group) => group.id !== groupId);
    state.connections = state.connections.map((connection) =>
      connection.groupId === groupId ? { ...connection, groupId: undefined } : connection
    );
    await this.write(state);
  }

  async addHistory(item: QueryHistoryItem): Promise<void> {
    return this.enqueueHistoryMutation(async () => {
      const state = await this.read();
      state.history = [item, ...state.history].slice(0, 200);
      await this.write(state);
    });
  }

  async getHistory(profileId?: string): Promise<QueryHistoryItem[]> {
    await this.historyQueue;
    const state = await this.read();
    return profileId ? state.history.filter((item) => item.profileId === profileId) : state.history;
  }

  async clearHistory(): Promise<void> {
    return this.enqueueHistoryMutation(async () => {
      const state = await this.read();
      state.history = [];
      await this.write(state);
    });
  }

  async listSavedQueries(profileId: string): Promise<SavedSqlQuery[]> {
    const state = await this.read();
    return state.savedQueries
      .filter((query) => query.profileId === profileId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async saveSavedQuery(input: SavedSqlQueryInput): Promise<SavedSqlQuery> {
    const name = input.name.trim();
    const sql = input.sql.trim();

    if (!input.profileId) {
      throw new Error("Connection is required.");
    }
    if (!name) {
      throw new Error("Saved query name is required.");
    }
    if (!sql) {
      throw new Error("Saved query SQL is required.");
    }

    const state = await this.read();
    const now = new Date().toISOString();
    const existing = input.id ? state.savedQueries.find((query) => query.id === input.id) : undefined;
    const saved: SavedSqlQuery = {
      id: existing?.id ?? randomUUID(),
      profileId: input.profileId,
      name,
      sql,
      description: input.description?.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt
    };

    state.savedQueries = existing
      ? state.savedQueries.map((query) => (query.id === saved.id ? saved : query))
      : [saved, ...state.savedQueries];

    await this.write(state);
    return saved;
  }

  async touchSavedQuery(queryId: string): Promise<SavedSqlQuery | null> {
    const state = await this.read();
    const existing = state.savedQueries.find((query) => query.id === queryId);
    if (!existing) {
      return null;
    }

    const saved = { ...existing, lastUsedAt: new Date().toISOString() };
    state.savedQueries = state.savedQueries.map((query) => (query.id === queryId ? saved : query));
    await this.write(state);
    return saved;
  }

  async deleteSavedQuery(queryId: string): Promise<void> {
    const state = await this.read();
    state.savedQueries = state.savedQueries.filter((query) => query.id !== queryId);
    await this.write(state);
  }

  async getSqlDraft(profileId: string): Promise<SqlEditorDraft | null> {
    const state = await this.read();
    return state.sqlDrafts[profileId] ?? null;
  }

  async saveSqlDraft(profileId: string, sql: string): Promise<SqlEditorDraft> {
    if (!profileId) {
      throw new Error("Connection is required.");
    }

    const state = await this.read();
    const draft: SqlEditorDraft = {
      profileId,
      sql,
      updatedAt: new Date().toISOString()
    };
    state.sqlDrafts = {
      ...state.sqlDrafts,
      [profileId]: draft
    };
    await this.write(state);
    return draft;
  }

  async getSettings(): Promise<AppSettings> {
    const state = await this.read();
    return normalizeSettings(state.settings);
  }

  async saveSettings(input: AppSettingsInput): Promise<AppSettings> {
    const state = await this.read();
    state.settings = normalizeSettings({
      ...state.settings,
      ...input
    });
    await this.write(state);
    return state.settings;
  }

  async getConnectionPickerLayout(): Promise<ConnectionPickerLayout | null> {
    const state = await this.read();
    return state.connectionPickerLayout ? parseConnectionPickerLayout(state.connectionPickerLayout) : null;
  }

  async saveConnectionPickerLayout(layout: ConnectionPickerLayout): Promise<ConnectionPickerLayout> {
    const state = await this.read();
    state.connectionPickerLayout = parseConnectionPickerLayout(layout) ?? {
      collapsedGroupIds: [],
      groupOrder: [],
      connectionOrder: {}
    };
    await this.write(state);
    return state.connectionPickerLayout;
  }

  private async read(): Promise<PersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        ...DEFAULT_STATE,
        ...parsed,
        savedQueries: normalizeSavedQueries(parsed.savedQueries),
        sqlDrafts: normalizeSqlDrafts(parsed.sqlDrafts),
        settings: normalizeSettings(parsed.settings)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          connections: [],
          groups: [],
          history: [],
          savedQueries: [],
          sqlDrafts: {},
          settings: DEFAULT_STATE.settings
        };
      }

      throw error;
    }
  }

  private async write(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private enqueueHistoryMutation(operation: () => Promise<void>): Promise<void> {
    const next = this.historyQueue.then(operation, operation);
    this.historyQueue = next.catch(() => undefined);
    return next;
  }

  private toStoredConnection(
    input: ConnectionInput,
    existing: StoredConnection | undefined,
    now: string
  ): StoredConnection {
    const existingPassword = existing?.password ?? this.decryptString(existing?.encryptedPassword);
    const shouldSavePassword = input.savePassword || Boolean(input.password);
    const password = shouldSavePassword ? input.password || existingPassword : undefined;
    const stored: StoredConnection = {
      id: input.id ?? randomUUID(),
      kind: input.kind ?? (input.engine === "s3-compatible" ? "storage" : "database"),
      engine: input.engine ?? "postgresql",
      groupId: input.groupId || undefined,
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      filePath: input.filePath || undefined,
      endpoint: input.endpoint || undefined,
      accountId: input.accountId || undefined,
      databaseId: input.databaseId || undefined,
      bucket: input.bucket || undefined,
      region: input.region || undefined,
      accessKeyId: input.accessKeyId || undefined,
      sessionToken: input.sessionToken || undefined,
      rootPrefix: input.rootPrefix || undefined,
      forcePathStyle: input.forcePathStyle,
      user: input.user,
      sslMode: input.sslMode,
      color: input.color,
      iconMode: input.iconMode,
      iconName: input.iconName || undefined,
      iconEmoji: input.iconEmoji || undefined,
      iconImage: input.iconImage || undefined,
      savePassword: shouldSavePassword,
      detectJsonColumns: Boolean(input.detectJsonColumns),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    // Secrets are never written as plain text; they live obfuscated in `encryptedPassword`.
    stored.password = undefined;
    stored.encryptedPassword = this.encryptString(password);
    return stored;
  }

  private toPublicConnection(connection: StoredConnection): ConnectionProfile {
    const { encryptedPassword: _encryptedPassword, ...publicConnection } = connection;
    const password = connection.password ?? this.decryptPassword(connection.encryptedPassword);
    const engine = publicConnection.engine ?? "postgresql";
    const kind = publicConnection.kind ?? (engine === "s3-compatible" ? "storage" : "database");

    return {
      ...publicConnection,
      kind,
      engine,
      filePath: publicConnection.filePath || undefined,
      endpoint: publicConnection.endpoint || undefined,
      accountId: publicConnection.accountId || undefined,
      databaseId: publicConnection.databaseId || undefined,
      bucket: publicConnection.bucket || undefined,
      region: publicConnection.region || undefined,
      accessKeyId: publicConnection.accessKeyId || undefined,
      sessionToken: publicConnection.sessionToken || undefined,
      rootPrefix: publicConnection.rootPrefix || undefined,
      forcePathStyle: publicConnection.forcePathStyle,
      iconMode: publicConnection.iconMode,
      iconName: publicConnection.iconName || undefined,
      iconEmoji: publicConnection.iconEmoji || undefined,
      iconImage: publicConnection.iconImage || undefined,
      password,
      hasPassword: Boolean(password)
    };
  }

  private decryptPassword(encryptedPassword?: string): string | undefined {
    return this.decryptString(encryptedPassword);
  }

  private encryptString(value?: string): string | undefined {
    // Local web app: secrets are obfuscated at rest in the state file instead of using an OS keychain.
    if (!value) {
      return undefined;
    }

    return Buffer.from(value, "utf8").toString("base64");
  }

  private decryptString(encryptedValue?: string): string | undefined {
    if (!encryptedValue) {
      return undefined;
    }

    return Buffer.from(encryptedValue, "base64").toString("utf8");
  }
}

function normalizeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    theme: settings?.theme === "light" || settings?.theme === "dark" ? settings.theme : "system"
  };
}

function normalizeSavedQueries(value: unknown): SavedSqlQuery[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const query = item as Partial<SavedSqlQuery>;
    if (
      typeof query.id !== "string" ||
      typeof query.profileId !== "string" ||
      typeof query.name !== "string" ||
      typeof query.sql !== "string" ||
      typeof query.createdAt !== "string" ||
      typeof query.updatedAt !== "string"
    ) {
      return [];
    }

    return [
      {
        id: query.id,
        profileId: query.profileId,
        name: query.name,
        sql: query.sql,
        description: typeof query.description === "string" && query.description.trim() ? query.description : undefined,
        createdAt: query.createdAt,
        updatedAt: query.updatedAt,
        lastUsedAt: typeof query.lastUsedAt === "string" ? query.lastUsedAt : undefined
      }
    ];
  });
}

function normalizeSqlDrafts(value: unknown): Record<string, SqlEditorDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const drafts: Record<string, SqlEditorDraft> = {};
  for (const [profileId, item] of Object.entries(value)) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const draft = item as Partial<SqlEditorDraft>;
    if (typeof draft.sql !== "string" || typeof draft.updatedAt !== "string") {
      continue;
    }

    drafts[profileId] = {
      profileId,
      sql: draft.sql,
      updatedAt: draft.updatedAt
    };
  }

  return drafts;
}

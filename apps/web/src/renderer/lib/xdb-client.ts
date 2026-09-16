import type {
  AppApi,
  AppSettingsInput,
  ConnectionGroupInput,
  ConnectionInput,
  DatabaseBackupProgress,
  DatabaseBackupResult,
  DatabaseRestoreProgress,
  DatabaseRestoreResult,
  DeleteRowInput,
  SavedSqlQueryInput,
  StorageCopyInput,
  StorageDeleteInput,
  StorageListInput,
  StorageMoveInput,
  StorageTransferProgress,
  TableFilterInput,
  TableSortInput,
  UpdateRowInput,
  UpsertRowInput
} from "../../shared/types";

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/ipc/${channel}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args })
  });

  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Request to ${channel} failed.`);
  }

  return body.data as T;
}

function pickFiles(options: { accept?: string; multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolvePromise) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.accept) {
      input.accept = options.accept;
    }
    if (options.multiple) {
      input.multiple = true;
    }
    if (options.directory) {
      input.setAttribute("webkitdirectory", "");
    }
    input.style.position = "fixed";
    input.style.inset = "0 auto auto -9999px";
    document.body.append(input);

    let settled = false;
    const finish = (files: File[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.remove();
      resolvePromise(files);
    };

    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    window.addEventListener(
      "focus",
      () => {
        // Give the change event a moment to fire after the dialog closes.
        window.setTimeout(() => finish(Array.from(input.files ?? [])), 300);
      },
      { once: true }
    );
    input.click();
  });
}

async function uploadFiles(files: File[], relativePaths?: string[]): Promise<{ paths: string[]; root: string }> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file, file.name);
  }
  form.append("relativePaths", JSON.stringify(relativePaths ?? []));

  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const body = (await response.json()) as ApiEnvelope<{ paths: string[]; root: string }>;
  if (!response.ok || !body.ok || !body.data) {
    throw new Error(body.error ?? "File upload failed.");
  }

  return body.data;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolvePromise(String(reader.result)));
    reader.addEventListener("error", () => rejectPromise(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

type ProgressListener<T> = (payload: T) => void;

const progressListeners = new Map<string, Set<ProgressListener<unknown>>>();
let eventSource: EventSource | null = null;

function subscribeToProgress<T>(channel: string, listener: ProgressListener<T>): () => void {
  let listeners = progressListeners.get(channel);
  if (!listeners) {
    listeners = new Set();
    progressListeners.set(channel, listeners);
  }

  listeners.add(listener as ProgressListener<unknown>);

  if (!eventSource) {
    eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { channel: string; payload: unknown };
        const channelListeners = progressListeners.get(parsed.channel);
        if (!channelListeners) {
          return;
        }

        for (const channelListener of channelListeners) {
          channelListener(parsed.payload);
        }
      } catch {
        // Ignore malformed progress events.
      }
    };
  }

  return () => {
    const channelListeners = progressListeners.get(channel);
    channelListeners?.delete(listener as ProgressListener<unknown>);
    if (channelListeners && channelListeners.size === 0) {
      progressListeners.delete(channel);
    }
  };
}

const api: AppApi = {
  getSettings: () => invoke("settings:get"),
  saveSettings: (input: AppSettingsInput) => invoke("settings:save", input),
  getConnectionPickerLayout: () => invoke("connection-picker-layout:get"),
  saveConnectionPickerLayout: (layout) => invoke("connection-picker-layout:save", layout),
  listConnections: () => invoke("connections:list"),
  getConnection: (profileId: string) => invoke("connections:get", profileId),
  saveConnection: (input: ConnectionInput) => invoke("connections:save", input),
  testConnection: (input: ConnectionInput) => invoke("connections:test", input),
  selectConnectionIconImage: async (): Promise<string | null> => {
    const [file] = await pickFiles({ accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp" });
    if (!file) {
      return null;
    }

    if (file.size > 512 * 1024) {
      throw new Error("Icon image must be smaller than 512 KB.");
    }

    return readFileAsDataUrl(file);
  },
  deleteConnection: (profileId: string) => invoke("connections:delete", profileId),
  exportConnections: (includeSecrets: boolean) => invoke("connections:export", includeSecrets),
  importConnections: async () => {
    const [file] = await pickFiles({ accept: ".json,application/json" });
    if (!file) {
      return null;
    }

    let archive: unknown;
    try {
      archive = JSON.parse(await file.text());
    } catch {
      throw new Error("Connection archive is not valid JSON.");
    }

    return invoke("connections:import", archive);
  },
  listConnectionGroups: () => invoke("connection-groups:list"),
  saveConnectionGroup: (input: ConnectionGroupInput) => invoke("connection-groups:save", input),
  deleteConnectionGroup: (groupId: string) => invoke("connection-groups:delete", groupId),
  selectSqliteDatabaseFile: async (): Promise<string | null> => {
    const files = await pickFiles({ accept: ".db,.sqlite,.sqlite3,.sqlite2" });
    const file = files[0];
    if (!file) {
      return null;
    }

    // Store the uploaded SQLite file inside the local data dir so it keeps working across sessions.
    const uploaded = await uploadFiles([file]);
    return uploaded.paths[0] ?? null;
  },
  connect: (profileId: string, password?: string) => invoke("database:connect", profileId, password),
  disconnect: (profileId: string) => invoke("database:disconnect", profileId),
  listObjects: (profileId: string) => invoke("database:objects", profileId),
  listDatabases: (profileId: string) => invoke("database:databases", profileId),
  createDatabase: (profileId: string, databaseName: string) =>
    invoke("database:create-database", profileId, databaseName),
  dropDatabase: (profileId: string, databaseName: string) => invoke("database:drop-database", profileId, databaseName),
  getTableStructure: (profileId: string, schema: string, table: string) =>
    invoke("database:structure", profileId, schema, table),
  getTableData: (
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ) => invoke("database:table-data", profileId, schema, table, page, pageSize, filters, sort),
  executeQuery: (profileId: string, sql: string) => invoke("database:execute", profileId, sql),
  insertRow: (input: UpsertRowInput) => invoke("database:insert", input),
  updateRow: (input: UpdateRowInput) => invoke("database:update", input),
  deleteRow: (input: DeleteRowInput) => invoke("database:delete", input),
  backupDatabase: (profileId: string, password?: string, taskId?: string): Promise<DatabaseBackupResult | null> =>
    invoke("database:backup", profileId, password, taskId),
  cancelBackup: (taskId: string) => invoke("database:backup-cancel", taskId),
  onBackupProgress: (listener: (progress: DatabaseBackupProgress) => void) =>
    subscribeToProgress<DatabaseBackupProgress>("database:backup-progress", listener),
  restoreDatabase: async (
    profileId: string,
    password?: string,
    taskId?: string
  ): Promise<DatabaseRestoreResult | null> => {
    const confirmed = window.confirm(
      "Restore this backup into the selected database?\n\nThis can overwrite existing schemas, tables, and data depending on the backup contents."
    );
    if (!confirmed) {
      return null;
    }

    const files = await pickFiles({ accept: ".sql,text/sql,text/plain" });
    const file = files[0];
    if (!file) {
      return null;
    }

    const uploaded = await uploadFiles([file]);
    const backupFilePath = uploaded.paths[0];
    if (!backupFilePath) {
      return null;
    }

    return invoke("database:restore", profileId, password, taskId, backupFilePath);
  },
  cancelRestore: (taskId: string) => invoke("database:restore-cancel", taskId),
  onRestoreProgress: (listener: (progress: DatabaseRestoreProgress) => void) =>
    subscribeToProgress<DatabaseRestoreProgress>("database:restore-progress", listener),
  listStorageBuckets: (profileId: string) => invoke("storage:buckets", profileId),
  selectStorageBucket: (profileId: string, bucket: string) => invoke("storage:select-bucket", profileId, bucket),
  listStorageObjects: (input: StorageListInput) => invoke("storage:objects", input),
  getStorageObjectMetadata: (profileId: string, key: string) => invoke("storage:metadata", profileId, key),
  previewStorageObject: (profileId: string, key: string) => invoke("storage:preview", profileId, key),
  downloadStorageObject: async (profileId: string, key: string) => {
    const params = new URLSearchParams({ profileId, key });
    window.open(`/api/storage/download?${params.toString()}`, "_blank");
    return null;
  },
  uploadStorageFiles: async (profileId: string, prefix: string, providedFiles?: File[], taskId?: string) => {
    const files = providedFiles ?? (await pickFiles({ multiple: true }));
    if (files.length === 0) {
      return null;
    }

    const uploaded = await uploadFiles(files);
    return invoke("storage:upload-files", profileId, prefix, uploaded.paths, taskId);
  },
  uploadStorageFolder: async (profileId: string, prefix: string, providedFiles?: File[], taskId?: string) => {
    const files = providedFiles ?? (await pickFiles({ directory: true, multiple: true }));
    if (files.length === 0) {
      return null;
    }

    const relativePaths = files.map((file) => {
      const relativeFile = file as File & { webkitRelativePath?: string };
      return relativeFile.webkitRelativePath ?? file.name;
    });

    const uploaded = await uploadFiles(files, relativePaths);
    return invoke("storage:upload-folder", profileId, prefix, uploaded.root, taskId);
  },
  onStorageTransferProgress: (listener: (progress: StorageTransferProgress) => void) =>
    subscribeToProgress<StorageTransferProgress>("storage:transfer-progress", listener),
  createStorageFolder: (profileId: string, prefix: string, name: string) =>
    invoke("storage:create-folder", profileId, prefix, name),
  copyStorageObject: (input: StorageCopyInput) => invoke("storage:copy", input),
  moveStorageObject: (input: StorageMoveInput) => invoke("storage:move", input),
  deleteStorageObjects: (input: StorageDeleteInput) => invoke("storage:delete", input),
  getHistory: (profileId?: string) => invoke("history:list", profileId),
  clearHistory: () => invoke("history:clear"),
  listSavedQueries: (profileId: string) => invoke("saved-queries:list", profileId),
  saveSavedQuery: (input: SavedSqlQueryInput) => invoke("saved-queries:save", input),
  deleteSavedQuery: (queryId: string) => invoke("saved-queries:delete", queryId),
  getSqlDraft: (profileId: string) => invoke("sql-drafts:get", profileId),
  saveSqlDraft: (profileId: string, sql: string) => invoke("sql-drafts:save", profileId, sql)
};

declare global {
  interface Window {
    xdb: AppApi;
  }
}

window.xdb = api;

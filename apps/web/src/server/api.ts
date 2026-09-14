import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppSettingsInput,
  ConnectionGroupInput,
  ConnectionInput,
  ConnectionPickerLayout,
  ConnectionProfile,
  DatabaseBackupProgress,
  DatabaseRestoreProgress,
  DeleteRowInput,
  SavedSqlQueryInput,
  StorageCopyInput,
  StorageDeleteInput,
  StorageListInput,
  StorageMoveInput,
  TableFilterInput,
  TableSortInput,
  UpdateRowInput,
  UpsertRowInput
} from "../shared/types";
import type { DatabaseService } from "../main/database";
import type { AppStore } from "../main/store";
import { defaultDataDir } from "../main/store";
import type { StorageService } from "../main/storage";

type ProgressChannel = "database:backup-progress" | "database:restore-progress";

export type ProgressEmitter = (channel: ProgressChannel, payload: unknown) => void;

const backupControllers = new Map<string, AbortController>();
const restoreControllers = new Map<string, AbortController>();

function defaultConnectionArchiveFileName(includeSecrets: boolean): string {
  const date = new Date().toISOString().slice(0, 10);
  const mode = includeSecrets ? "complete" : "safe";
  return `xdb-connections-${mode}-${date}.xdb-connections.json`;
}

const ICON_IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp"
};

export function iconImageMimeForExtension(extension: string): string {
  return ICON_IMAGE_MIME_TYPES[extension.toLowerCase()] ?? "image/png";
}

export function createApiHandlers(input: {
  store: AppStore;
  database: DatabaseService;
  storage: StorageService;
  dataDir?: string;
}) {
  const { store, database, storage } = input;
  const dataDir = input.dataDir ?? defaultDataDir();
  const exportsDir = join(dataDir, "exports");
  const downloadsDir = join(exportsDir, "downloads");
  const backupsDir = join(dataDir, "backups");

  const handlers: Record<string, (...args: never[]) => unknown> = {
    "settings:get": () => store.getSettings(),
    "settings:save": (input_: AppSettingsInput) => store.saveSettings(input_),
    "connection-picker-layout:get": () => store.getConnectionPickerLayout(),
    "connection-picker-layout:save": (layout: ConnectionPickerLayout) => store.saveConnectionPickerLayout(layout),
    "connections:list": () => store.listConnections(),
    "connections:get": (profileId: string) => store.getConnection(profileId),
    "connections:save": async (connectionInput: ConnectionInput) => database.saveConnection(connectionInput),
    "connections:test": async (connectionInput: ConnectionInput) => {
      let saved: ConnectionProfile | null = null;
      try {
        saved = await database.saveConnection(connectionInput);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          profile: null
        };
      }

      try {
        if (saved.engine === "s3-compatible") {
          const status = await storage.connect(saved.id);
          await storage.disconnect(saved.id);
          return {
            ok: true,
            message: `Connected to bucket "${status.bucket}".`,
            profile: saved
          };
        }

        const status = await database.connect(saved.id);
        await database.disconnect(saved.id);
        const detail = [status.currentUser ? `as ${status.currentUser}` : null, status.serverVersion ?? null]
          .filter(Boolean)
          .join(" ");
        return {
          ok: true,
          message: `Connected to ${status.database ?? saved.name}${detail ? ` (${detail})` : ""}.`,
          profile: saved,
          serverVersion: status.serverVersion
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          profile: saved
        };
      }
    },
    "connections:delete": async (profileId: string) => {
      await database.disconnect(profileId);
      await storage.disconnect(profileId);
      await store.deleteConnection(profileId);
    },
    "connections:export": async (includeSecrets: boolean) => {
      const archive = await store.exportConnectionArchive(Boolean(includeSecrets));
      await mkdir(exportsDir, { recursive: true });
      const fileName = defaultConnectionArchiveFileName(archive.includeSecrets);
      const filePath = join(exportsDir, fileName);
      await writeFile(filePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
      return {
        filePath,
        groups: archive.groups.length,
        connections: archive.connections.length,
        includeSecrets: archive.includeSecrets
      };
    },
    "connections:import": async (archive: unknown) => {
      const imported = await store.importConnectionArchive(archive);
      return imported;
    },
    "connection-groups:list": () => store.listConnectionGroups(),
    "connection-groups:save": (groupInput: ConnectionGroupInput) => store.saveConnectionGroup(groupInput),
    "connection-groups:delete": (groupId: string) => store.deleteConnectionGroup(groupId),
    "database:connect": async (profileId: string, password?: string) => {
      const profile = await store.getConnection(profileId);
      if (profile?.engine === "s3-compatible") {
        return storage.connect(profileId, password);
      }

      return database.connect(profileId, password);
    },
    "database:disconnect": async (profileId: string) => {
      await Promise.all([database.disconnect(profileId), storage.disconnect(profileId)]);
    },
    "database:objects": (profileId: string) => database.listObjects(profileId),
    "database:databases": (profileId: string) => database.listDatabases(profileId),
    "database:create-database": (profileId: string, databaseName: string) =>
      database.createDatabase(profileId, databaseName),
    "database:drop-database": (profileId: string, databaseName: string) =>
      database.dropDatabase(profileId, databaseName),
    "database:structure": (profileId: string, schema: string, table: string) =>
      database.getTableStructure(profileId, schema, table),
    "database:table-data": (
      profileId: string,
      schema: string,
      table: string,
      page: number,
      pageSize: number,
      filters?: TableFilterInput,
      sort?: TableSortInput | null
    ) => database.getTableData(profileId, schema, table, page, pageSize, filters, sort),
    "database:execute": (profileId: string, sql: string) => database.executeQuery(profileId, sql),
    "database:insert": (rowInput: UpsertRowInput) => database.insertRow(rowInput),
    "database:update": (rowInput: UpdateRowInput) => database.updateRow(rowInput),
    "database:delete": (rowInput: DeleteRowInput) => database.deleteRow(rowInput),
    "database:backup": async (
      profileId: string,
      password?: string,
      requestedTaskId?: string,
      _backupDirectory?: string
    ) => {
      const taskId = requestedTaskId || randomUUID();
      const controller = new AbortController();
      backupControllers.set(taskId, controller);

      try {
        return await database.backupDatabase(profileId, backupsDir, password, {
          taskId,
          signal: controller.signal,
          onProgress: (progress: DatabaseBackupProgress) => emitProgress("database:backup-progress", progress)
        });
      } finally {
        backupControllers.delete(taskId);
      }
    },
    "database:backup-cancel": (taskId: string) => {
      backupControllers.get(taskId)?.abort();
    },
    "database:restore": async (
      profileId: string,
      password?: string,
      requestedTaskId?: string,
      backupFilePath?: string
    ) => {
      if (!backupFilePath) {
        throw new Error("Choose a SQL backup file to restore first.");
      }

      const taskId = requestedTaskId || randomUUID();
      const controller = new AbortController();
      restoreControllers.set(taskId, controller);

      try {
        return await database.restoreDatabase(profileId, backupFilePath, password, {
          taskId,
          signal: controller.signal,
          onProgress: (progress: DatabaseRestoreProgress) => emitProgress("database:restore-progress", progress)
        });
      } finally {
        restoreControllers.delete(taskId);
      }
    },
    "database:restore-cancel": (taskId: string) => {
      restoreControllers.get(taskId)?.abort();
    },
    "storage:objects": (storageListInput: StorageListInput) => storage.listObjects(storageListInput),
    "storage:metadata": (profileId: string, key: string) => storage.getObjectMetadata(profileId, key),
    "storage:preview": (profileId: string, key: string) => storage.previewObject(profileId, key),
    "storage:download": async (profileId: string, key: string) => {
      const fileName = key.replace(/\/+$/, "").split("/").pop() || "download";
      await mkdir(downloadsDir, { recursive: true });
      const filePath = join(downloadsDir, `${randomUUID()}-${fileName}`);
      return storage.downloadObject(profileId, key, filePath);
    },
    "storage:upload-files": async (profileId: string, prefix: string, filePaths?: string[]) => {
      if (!filePaths || filePaths.length === 0) {
        return null;
      }

      return storage.uploadFiles(profileId, prefix, filePaths);
    },
    "storage:upload-folder": async (profileId: string, prefix: string, folderPath?: string) => {
      if (!folderPath) {
        return null;
      }

      return storage.uploadFolder(profileId, prefix, folderPath);
    },
    "storage:create-folder": (profileId: string, prefix: string, name: string) =>
      storage.createFolder(profileId, prefix, name),
    "storage:copy": (copyInput: StorageCopyInput) => storage.copyObject(copyInput),
    "storage:move": (moveInput: StorageMoveInput) => storage.moveObject(moveInput),
    "storage:delete": (deleteInput: StorageDeleteInput) => storage.deleteObjects(deleteInput),
    "history:list": (profileId?: string) => store.getHistory(profileId),
    "history:clear": () => store.clearHistory(),
    "saved-queries:list": (profileId: string) => store.listSavedQueries(profileId),
    "saved-queries:save": (queryInput: SavedSqlQueryInput) => store.saveSavedQuery(queryInput),
    "saved-queries:delete": (queryId: string) => store.deleteSavedQuery(queryId),
    "sql-drafts:get": (profileId: string) => store.getSqlDraft(profileId),
    "sql-drafts:save": (profileId: string, sql: string) => store.saveSqlDraft(profileId, sql)
  };

  let emitProgress: ProgressEmitter = () => {};

  return {
    handlers,
    exportsDir,
    downloadsDir,
    backupsDir,
    setProgressEmitter(emitter: ProgressEmitter): void {
      emitProgress = emitter;
    },
    hasHandler(channel: string): boolean {
      return Object.hasOwn(handlers, channel);
    },
    async invoke(channel: string, args: unknown[]): Promise<unknown> {
      const handler = handlers[channel] as ((...handlerArgs: unknown[]) => unknown) | undefined;
      if (!handler) {
        throw new Error(`Unknown command: ${channel}`);
      }

      return handler(...args);
    }
  };
}

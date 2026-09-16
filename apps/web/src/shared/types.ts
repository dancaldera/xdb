export type SslMode = "disable" | "prefer" | "require";
export type ConnectionIconMode = "default" | "icon" | "emoji" | "image";
export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
  theme: ThemePreference;
};

export type ConnectionPickerLayout = {
  collapsedGroupIds: string[];
  groupOrder: string[];
  connectionOrder: Record<string, string[]>;
  scrollTop?: number;
};

export type AppSettingsInput = Partial<AppSettings>;

export type DatabaseEngine = "postgresql" | "mysql" | "sqlite" | "turso" | "cloudflare-d1";
export type StorageEngine = "s3-compatible";
export type ConnectionEngine = DatabaseEngine | StorageEngine;
export type ConnectionKind = "database" | "storage";

export type ConnectionProfile = {
  id: string;
  kind: ConnectionKind;
  engine: ConnectionEngine;
  groupId?: string;
  name: string;
  host: string;
  port: number;
  database: string;
  filePath?: string;
  endpoint?: string;
  accountId?: string;
  databaseId?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  sessionToken?: string;
  rootPrefix?: string;
  forcePathStyle?: boolean;
  user: string;
  password?: string;
  sslMode: SslMode;
  color: string;
  iconMode?: ConnectionIconMode;
  iconName?: string;
  iconEmoji?: string;
  iconImage?: string;
  savePassword: boolean;
  detectJsonColumns?: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionInput = Omit<
  ConnectionProfile,
  "id" | "kind" | "engine" | "hasPassword" | "createdAt" | "updatedAt" | "password"
> & {
  id?: string;
  kind?: ConnectionKind;
  engine?: ConnectionEngine;
  connectionUrl?: string;
  password?: string;
};

export type ConnectionGroup = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionGroupInput = {
  id?: string;
  name: string;
  color: string;
};

export type ConnectionArchive = {
  format: "xdb.connections";
  version: 1;
  exportedAt: string;
  includeSecrets: boolean;
  groups: ConnectionGroup[];
  connections: ConnectionProfile[];
};

export type ConnectionExportResult = {
  filePath: string;
  groups: number;
  connections: number;
  includeSecrets: boolean;
};

export type ConnectionImportResult = {
  filePath: string;
  groups: number;
  connections: number;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  profile: ConnectionProfile | null;
  serverVersion?: string;
};

export type ConnectionStatus = {
  profileId: string;
  engine: DatabaseEngine;
  connected: boolean;
  database?: string;
  serverVersion?: string;
  currentUser?: string;
};

export type StorageStatus = {
  profileId: string;
  engine: "s3-compatible";
  connected: boolean;
  bucket: string;
  region: string;
  endpoint: string;
  rootPrefix: string;
};

export type ConnectionRuntimeStatus = ConnectionStatus | StorageStatus;

export type DatabaseObjectType = "base_table" | "view" | "materialized_view" | "foreign_table";

export type DatabaseObject = {
  schema: string;
  name: string;
  type: DatabaseObjectType;
  estimatedRows: number | null;
};

export type DatabaseInfo = {
  name: string;
  owner: string | null;
  isCurrent: boolean;
  canDrop: boolean;
};

export type TableColumn = {
  name: string;
  dataType: string;
  enumValues?: string[];
  nullable: boolean;
  defaultValue: string | null;
  ordinalPosition: number;
  maxLength: number | null;
  numericPrecision: number | null;
  isPrimaryKey: boolean;
};

export type TableIndex = {
  name: string;
  definition: string;
  isPrimary: boolean;
  isUnique: boolean;
};

export type TableStructure = {
  schema: string;
  table: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  primaryKeys: string[];
};

export type TableFilterOperator =
  | "equals"
  | "notEquals"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "contains"
  | "notContains"
  | "startsWith"
  | "notStartsWith"
  | "endsWith"
  | "notEndsWith"
  | "isNull"
  | "isNotNull"
  | "in"
  | "notIn";

export type TableFilterRule = {
  id: string;
  enabled: boolean;
  column: string | null;
  operator: TableFilterOperator;
  value: string;
};

export type TableFilterInput = {
  rules: TableFilterRule[];
};

export type TableSortDirection = "asc" | "desc";

export type TableSortInput = {
  column: string;
  direction: TableSortDirection;
};

export type QueryField = {
  name: string;
  dataTypeID: number;
};

export type QueryExecutionResult = {
  rows: Record<string, unknown>[];
  fields: QueryField[];
  rowCount: number | null;
  command: string;
  durationMs: number;
  truncated?: boolean;
  notice?: string;
};

export type QueryHistorySource = "query-editor" | "table-data" | "row-edit";

export type QueryHistoryTarget = {
  schema?: string;
  table?: string;
  action?: "select" | "insert" | "update" | "delete";
};

export type TableDataResult = {
  schema: string;
  table: string;
  rows: Record<string, unknown>[];
  columns: TableColumn[];
  primaryKeys: string[];
  totalRows: number;
  page: number;
  pageSize: number;
};

export type UpsertRowInput = {
  profileId: string;
  schema: string;
  table: string;
  values: Record<string, unknown>;
};

export type UpdateRowInput = UpsertRowInput & {
  key: Record<string, unknown>;
};

export type DeleteRowInput = {
  profileId: string;
  schema: string;
  table: string;
  key: Record<string, unknown>;
};

export type QueryHistoryItem = {
  id: string;
  profileId: string;
  engine: DatabaseEngine;
  database: string;
  sql: string;
  durationMs: number;
  rowCount: number | null;
  command: string;
  createdAt: string;
  source?: QueryHistorySource;
  target?: QueryHistoryTarget;
};

export type SavedSqlQuery = {
  id: string;
  profileId: string;
  name: string;
  sql: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type SavedSqlQueryInput = {
  id?: string;
  profileId: string;
  name: string;
  sql: string;
  description?: string;
};

export type SqlEditorDraft = {
  profileId: string;
  sql: string;
  updatedAt: string;
};

export type DatabaseBackupResult = {
  filePath: string;
  taskId?: string;
};

export type DatabaseBackupProgress = {
  taskId: string;
  phase: "selecting-folder" | "preparing" | "schema" | "data" | "done" | "failed" | "cancelled";
  message?: string;
  table?: string;
  tablesDone?: number;
  tablesTotal?: number;
};

export type DatabaseRestoreResult = {
  filePath: string;
  taskId?: string;
};

export type DatabaseRestoreProgress = {
  taskId: string;
  phase: "selecting-file" | "preparing" | "executing" | "copying-data" | "done" | "failed" | "cancelled";
  message?: string;
  table?: string;
  statementsDone?: number;
};

export type StorageObjectType = "folder" | "file";

export type StorageObject = {
  type: StorageObjectType;
  key: string;
  name: string;
  prefix: string;
  size: number | null;
  etag: string | null;
  lastModified: string | null;
  contentType?: string | null;
};

export type StorageListInput = {
  profileId: string;
  prefix?: string;
  continuationToken?: string;
  pageSize?: number;
  filter?: string;
};

export type StorageBucket = {
  name: string;
  creationDate: string | null;
};

export type StorageListResult = {
  bucket: string;
  prefix: string;
  objects: StorageObject[];
  nextContinuationToken: string | null;
  isTruncated: boolean;
};

export type StorageObjectMetadata = {
  key: string;
  size: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  metadata: Record<string, string>;
};

export type StoragePreviewResult =
  | {
      kind: "image" | "video" | "audio" | "pdf";
      key: string;
      contentType: string;
      url: string;
      size: number | null;
    }
  | {
      kind: "text";
      key: string;
      contentType: string;
      text: string;
      truncated: boolean;
      size: number | null;
    }
  | {
      kind: "unsupported";
      key: string;
      contentType: string | null;
      size: number | null;
      reason: string;
    };

export type StorageCopyInput = {
  profileId: string;
  sourceKey: string;
  destinationKey: string;
  overwrite?: boolean;
};

export type StorageMoveInput = StorageCopyInput;

export type StorageDeleteInput = {
  profileId: string;
  keys: string[];
};

export type StorageTransferResult = {
  uploaded: number;
  skipped: number;
  failed?: number;
};

export type StorageTransferProgress = {
  taskId: string;
  phase: "uploading" | "done" | "failed";
  done: number;
  total: number;
  current?: string;
};

export type StorageDownloadResult = {
  filePath: string;
};

export type AppApi = {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (input: AppSettingsInput) => Promise<AppSettings>;
  getConnectionPickerLayout: () => Promise<ConnectionPickerLayout | null>;
  saveConnectionPickerLayout: (layout: ConnectionPickerLayout) => Promise<ConnectionPickerLayout>;
  listConnections: () => Promise<ConnectionProfile[]>;
  getConnection: (profileId: string) => Promise<ConnectionProfile | null>;
  saveConnection: (input: ConnectionInput) => Promise<ConnectionProfile>;
  testConnection: (input: ConnectionInput) => Promise<ConnectionTestResult>;
  selectConnectionIconImage: () => Promise<string | null>;
  deleteConnection: (profileId: string) => Promise<void>;
  exportConnections: (includeSecrets: boolean) => Promise<ConnectionExportResult | null>;
  importConnections: () => Promise<ConnectionImportResult | null>;
  listConnectionGroups: () => Promise<ConnectionGroup[]>;
  saveConnectionGroup: (input: ConnectionGroupInput) => Promise<ConnectionGroup>;
  deleteConnectionGroup: (groupId: string) => Promise<void>;
  selectSqliteDatabaseFile: () => Promise<string | null>;
  connect: (profileId: string, password?: string) => Promise<ConnectionRuntimeStatus>;
  disconnect: (profileId: string) => Promise<void>;
  listObjects: (profileId: string) => Promise<DatabaseObject[]>;
  listDatabases: (profileId: string) => Promise<DatabaseInfo[]>;
  createDatabase: (profileId: string, databaseName: string) => Promise<void>;
  dropDatabase: (profileId: string, databaseName: string) => Promise<void>;
  getTableStructure: (profileId: string, schema: string, table: string) => Promise<TableStructure>;
  getTableData: (
    profileId: string,
    schema: string,
    table: string,
    page: number,
    pageSize: number,
    filters?: TableFilterInput,
    sort?: TableSortInput | null
  ) => Promise<TableDataResult>;
  executeQuery: (profileId: string, sql: string) => Promise<QueryExecutionResult>;
  insertRow: (input: UpsertRowInput) => Promise<void>;
  updateRow: (input: UpdateRowInput) => Promise<void>;
  deleteRow: (input: DeleteRowInput) => Promise<void>;
  backupDatabase: (profileId: string, password?: string, taskId?: string) => Promise<DatabaseBackupResult | null>;
  cancelBackup: (taskId: string) => Promise<void>;
  onBackupProgress: (listener: (progress: DatabaseBackupProgress) => void) => () => void;
  restoreDatabase: (profileId: string, password?: string, taskId?: string) => Promise<DatabaseRestoreResult | null>;
  cancelRestore: (taskId: string) => Promise<void>;
  onRestoreProgress: (listener: (progress: DatabaseRestoreProgress) => void) => () => void;
  listStorageBuckets: (profileId: string) => Promise<StorageBucket[]>;
  selectStorageBucket: (profileId: string, bucket: string) => Promise<StorageStatus>;
  listStorageObjects: (input: StorageListInput) => Promise<StorageListResult>;
  getStorageObjectMetadata: (profileId: string, key: string) => Promise<StorageObjectMetadata>;
  previewStorageObject: (profileId: string, key: string) => Promise<StoragePreviewResult>;
  downloadStorageObject: (profileId: string, key: string) => Promise<StorageDownloadResult | null>;
  uploadStorageFiles: (
    profileId: string,
    prefix: string,
    files?: File[],
    taskId?: string
  ) => Promise<StorageTransferResult | null>;
  uploadStorageFolder: (
    profileId: string,
    prefix: string,
    files?: File[],
    taskId?: string
  ) => Promise<StorageTransferResult | null>;
  onStorageTransferProgress: (listener: (progress: StorageTransferProgress) => void) => () => void;
  createStorageFolder: (profileId: string, prefix: string, name: string) => Promise<void>;
  copyStorageObject: (input: StorageCopyInput) => Promise<void>;
  moveStorageObject: (input: StorageMoveInput) => Promise<void>;
  deleteStorageObjects: (input: StorageDeleteInput) => Promise<void>;
  getHistory: (profileId?: string) => Promise<QueryHistoryItem[]>;
  clearHistory: () => Promise<void>;
  listSavedQueries: (profileId: string) => Promise<SavedSqlQuery[]>;
  saveSavedQuery: (input: SavedSqlQueryInput) => Promise<SavedSqlQuery>;
  deleteSavedQuery: (queryId: string) => Promise<void>;
  getSqlDraft: (profileId: string) => Promise<SqlEditorDraft | null>;
  saveSqlDraft: (profileId: string, sql: string) => Promise<SqlEditorDraft>;
};

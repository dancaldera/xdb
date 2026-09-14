import { randomUUID } from "node:crypto";
import type {
  ConnectionArchive,
  ConnectionEngine,
  ConnectionGroup,
  ConnectionIconMode,
  ConnectionInput,
  ConnectionKind,
  ConnectionProfile,
  SslMode
} from "./types";

export const CONNECTION_ARCHIVE_FORMAT = "xdb.connections";
export const CONNECTION_ARCHIVE_VERSION = 1;

const CONNECTION_ENGINES = new Set<ConnectionEngine>([
  "postgresql",
  "mysql",
  "sqlite",
  "turso",
  "cloudflare-d1",
  "s3-compatible"
]);
const CONNECTION_KINDS = new Set<ConnectionKind>(["database", "storage"]);
const SSL_MODES = new Set<SslMode>(["disable", "prefer", "require"]);
const CONNECTION_ICON_MODES = new Set<ConnectionIconMode>(["default", "icon", "emoji", "image"]);

type ConnectionArchiveCopyOptions = {
  idProvider?: () => string;
  now?: string;
};

export type ConnectionArchiveCopy = {
  groups: ConnectionGroup[];
  connections: ConnectionInput[];
};

export function createConnectionArchive(input: {
  connections: ConnectionProfile[];
  groups: ConnectionGroup[];
  includeSecrets: boolean;
  exportedAt?: string;
}): ConnectionArchive {
  return {
    format: CONNECTION_ARCHIVE_FORMAT,
    version: CONNECTION_ARCHIVE_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    includeSecrets: input.includeSecrets,
    groups: input.groups.map((group) => ({ ...group })),
    connections: input.connections.map((connection) => sanitizeArchiveConnection(connection, input.includeSecrets))
  };
}

export function parseConnectionArchive(value: unknown): ConnectionArchive {
  const archive = objectValue(value, "Connection archive");
  const format = stringValue(archive.format, "Connection archive format");

  if (format !== CONNECTION_ARCHIVE_FORMAT) {
    throw new Error(`Connection archive format "${format}" is not supported. Expected "${CONNECTION_ARCHIVE_FORMAT}".`);
  }

  parseArchiveVersion(archive.version);

  return {
    format: CONNECTION_ARCHIVE_FORMAT,
    version: CONNECTION_ARCHIVE_VERSION,
    exportedAt: stringValue(archive.exportedAt, "Connection archive export date"),
    includeSecrets: booleanValue(archive.includeSecrets, "Connection archive secret flag"),
    groups: arrayValue(archive.groups, "Connection archive groups").map(parseArchiveGroup),
    connections: arrayValue(archive.connections, "Connection archive connections").map(parseArchiveConnection)
  };
}

export function createConnectionArchiveCopies(
  value: unknown,
  options: ConnectionArchiveCopyOptions = {}
): ConnectionArchiveCopy {
  const archive = parseConnectionArchive(value);
  const idProvider = options.idProvider ?? randomUUID;
  const now = options.now ?? new Date().toISOString();
  const groupIdMap = new Map<string, string>();
  const groups = archive.groups.map((group) => {
    const id = idProvider();
    groupIdMap.set(group.id, id);
    return {
      ...group,
      id,
      createdAt: now,
      updatedAt: now
    };
  });
  const connections = archive.connections.map((connection) => {
    const { hasPassword: _hasPassword, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = connection;
    const password = connection.password || undefined;

    return {
      ...input,
      id: idProvider(),
      groupId: connection.groupId ? groupIdMap.get(connection.groupId) : undefined,
      password,
      savePassword: Boolean(password) || connection.savePassword,
      connectionUrl: undefined
    };
  });

  return { groups, connections };
}

function sanitizeArchiveConnection(connection: ConnectionProfile, includeSecrets: boolean): ConnectionProfile {
  const password = includeSecrets ? connection.password : undefined;

  return {
    ...connection,
    password,
    savePassword: includeSecrets ? connection.savePassword : false,
    hasPassword: includeSecrets && Boolean(password)
  };
}

function parseArchiveGroup(value: unknown): ConnectionGroup {
  const group = objectValue(value, "Connection group");
  return {
    id: stringValue(group.id, "Connection group id"),
    name: stringValue(group.name, "Connection group name"),
    color: stringValue(group.color, "Connection group color"),
    createdAt: stringValue(group.createdAt, "Connection group created date"),
    updatedAt: stringValue(group.updatedAt, "Connection group updated date")
  };
}

function parseArchiveConnection(value: unknown): ConnectionProfile {
  const connection = objectValue(value, "Connection profile");
  const engine = enumValue(connection.engine, CONNECTION_ENGINES, "Connection engine");
  const kind = enumValue(connection.kind, CONNECTION_KINDS, "Connection kind");

  return {
    id: stringValue(connection.id, "Connection id"),
    kind,
    engine,
    groupId: optionalStringValue(connection.groupId, "Connection group id"),
    name: stringValue(connection.name, "Connection name"),
    host: stringValue(connection.host, "Connection host"),
    port: numberValue(connection.port, "Connection port"),
    database: stringValue(connection.database, "Connection database"),
    filePath: optionalStringValue(connection.filePath, "Connection file path"),
    endpoint: optionalStringValue(connection.endpoint, "Connection endpoint"),
    accountId: optionalStringValue(connection.accountId, "Connection account id"),
    databaseId: optionalStringValue(connection.databaseId, "Connection database id"),
    bucket: optionalStringValue(connection.bucket, "Connection bucket"),
    region: optionalStringValue(connection.region, "Connection region"),
    accessKeyId: optionalStringValue(connection.accessKeyId, "Connection access key id"),
    sessionToken: optionalStringValue(connection.sessionToken, "Connection session token"),
    rootPrefix: optionalStringValue(connection.rootPrefix, "Connection root prefix"),
    forcePathStyle: optionalBooleanValue(connection.forcePathStyle, "Connection force path style"),
    user: stringValue(connection.user, "Connection user"),
    password: optionalStringValue(connection.password, "Connection password"),
    sslMode: enumValue(connection.sslMode, SSL_MODES, "Connection SSL mode"),
    color: stringValue(connection.color, "Connection color"),
    iconMode: optionalEnumValue(connection.iconMode, CONNECTION_ICON_MODES, "Connection icon mode"),
    iconName: optionalStringValue(connection.iconName, "Connection icon name"),
    iconEmoji: optionalStringValue(connection.iconEmoji, "Connection icon emoji"),
    iconImage: optionalStringValue(connection.iconImage, "Connection icon image"),
    savePassword: booleanValue(connection.savePassword, "Connection save password flag"),
    detectJsonColumns: optionalBooleanValue(connection.detectJsonColumns, "Connection detect JSON flag"),
    hasPassword: booleanValue(connection.hasPassword, "Connection password flag"),
    createdAt: stringValue(connection.createdAt, "Connection created date"),
    updatedAt: stringValue(connection.updatedAt, "Connection updated date")
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }

  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function optionalStringValue(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return stringValue(value, label);
}

function parseArchiveVersion(value: unknown): number {
  // Accept numeric strings like "1" for archives produced by other tools.
  const version = typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : value;

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error(`Connection archive version ${JSON.stringify(value)} is invalid.`);
  }

  if (version > CONNECTION_ARCHIVE_VERSION) {
    throw new Error(
      `Connection archive version ${version} is not supported. This app supports up to version ${CONNECTION_ARCHIVE_VERSION}.`
    );
  }

  return version;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }

  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function optionalBooleanValue(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return booleanValue(value, label);
}

function enumValue<T extends string>(value: unknown, values: Set<T>, label: string): T {
  if (typeof value !== "string" || !values.has(value as T)) {
    throw new Error(`${label} is invalid.`);
  }

  return value as T;
}

function optionalEnumValue<T extends string>(value: unknown, values: Set<T>, label: string): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return enumValue(value, values, label);
}

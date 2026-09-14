import type { ConnectionInput, ConnectionProfile, SslMode } from "./types";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const MYSQL_PROTOCOLS = new Set(["mysql:"]);
const SQLITE_PROTOCOLS = new Set(["sqlite:"]);
const TURSO_PROTOCOLS = new Set(["libsql:", "https:"]);
const D1_PROTOCOLS = new Set(["d1:"]);
const S3_PROTOCOLS = new Set(["s3+https:", "s3+http:"]);

export function normalizeConnectionInput(input: ConnectionInput): ConnectionInput {
  const connectionUrl = input.connectionUrl?.trim();
  if (!connectionUrl) {
    return normalizeManualConnectionInput(input);
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionUrl);
  } catch {
    throw new Error("Connection URL is invalid.");
  }

  if (POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    return normalizePostgresUrlInput(input, parsed);
  }

  if (MYSQL_PROTOCOLS.has(parsed.protocol)) {
    return normalizeMysqlUrlInput(input, parsed);
  }

  if (SQLITE_PROTOCOLS.has(parsed.protocol)) {
    return normalizeSqliteUrlInput(input, parsed);
  }

  if (TURSO_PROTOCOLS.has(parsed.protocol)) {
    return normalizeTursoUrlInput(input, parsed);
  }

  if (D1_PROTOCOLS.has(parsed.protocol)) {
    return normalizeD1UrlInput(input, parsed);
  }

  if (S3_PROTOCOLS.has(parsed.protocol)) {
    return normalizeS3UrlInput(input, parsed);
  }

  throw new Error(
    "Connection URL must start with postgres://, postgresql://, mysql://, sqlite://, libsql://, https://, d1://, or s3+https://."
  );
}

export function buildConnectionString(
  profile: Pick<
    ConnectionProfile,
    | "engine"
    | "host"
    | "port"
    | "database"
    | "filePath"
    | "endpoint"
    | "accountId"
    | "databaseId"
    | "bucket"
    | "region"
    | "accessKeyId"
    | "sessionToken"
    | "rootPrefix"
    | "forcePathStyle"
    | "user"
    | "password"
    | "sslMode"
  >
): string {
  if (profile.engine === "sqlite") {
    return `sqlite://${encodeSqlitePath(profile.filePath ?? profile.database)}`;
  }

  if (profile.engine === "turso") {
    const endpoint = profile.endpoint ?? "";
    if (!profile.password) {
      return endpoint;
    }

    const parsed = new URL(endpoint);
    parsed.searchParams.set("authToken", profile.password);
    return parsed.toString();
  }

  if (profile.engine === "cloudflare-d1") {
    const accountId = encodeUrlComponent(profile.accountId ?? "");
    const databaseId = encodeUrlComponent(profile.databaseId ?? profile.database);
    const url = new URL(`d1://${accountId}/${databaseId}`);
    if (profile.password) {
      url.searchParams.set("apiToken", profile.password);
    }
    return url.toString();
  }

  if (profile.engine === "s3-compatible") {
    const protocol = profile.endpoint?.startsWith("http://") ? "s3+http" : "s3+https";
    const auth = profile.accessKeyId
      ? `${encodeUrlComponent(profile.accessKeyId)}${profile.password ? `:${encodeUrlComponent(profile.password)}` : ""}@`
      : "";
    const params = new URLSearchParams();
    if (profile.endpoint) {
      params.set("endpoint", profile.endpoint);
    }
    params.set("region", profile.region || "us-east-1");
    params.set("forcePathStyle", String(profile.forcePathStyle ?? true));
    if (profile.rootPrefix) {
      params.set("rootPrefix", profile.rootPrefix);
    }
    if (profile.sessionToken) {
      params.set("sessionToken", profile.sessionToken);
    }
    return `${protocol}://${auth}${encodeUrlComponent(profile.bucket ?? "")}?${params.toString()}`;
  }

  const auth = profile.user
    ? `${encodeUrlComponent(profile.user)}${profile.password ? `:${encodeUrlComponent(profile.password)}` : ""}@`
    : "";
  const protocol = profile.engine === "mysql" ? "mysql" : "postgresql";
  const baseUrl = `${protocol}://${auth}${formatConnectionUrlHost(profile.host)}:${profile.port}/${encodeUrlComponent(
    profile.database
  )}`;

  if (profile.engine === "mysql") {
    const params = profile.sslMode === "disable" ? "" : `?ssl=${profile.sslMode}`;
    return `${baseUrl}${params}`;
  }

  const params = new URLSearchParams({ sslmode: profile.sslMode });
  return `${baseUrl}?${params.toString()}`;
}

function normalizePostgresUrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  const host = stripIpv6Brackets(parsed.hostname);
  if (!host) {
    throw new Error("Postgres connection URL must include a host.");
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Postgres connection URL port is invalid.");
  }

  const database = decodeUrlComponent(parsed.pathname.replace(/^\/+/, ""));
  const user = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);
  const sslMode = sslModeFromUrl(parsed.searchParams.get("sslmode")) ?? input.sslMode;
  const derivedName = [database || input.database, host].filter(Boolean).join("@");

  return trimConnectionFields({
    ...input,
    engine: "postgresql",
    name: input.name.trim() || derivedName || host,
    host,
    port,
    database: database || input.database,
    filePath: undefined,
    user: user || input.user,
    password: input.password || password,
    sslMode,
    connectionUrl: undefined
  });
}

function normalizeMysqlUrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  const host = stripIpv6Brackets(parsed.hostname);
  if (!host) {
    throw new Error("MySQL connection URL must include a host.");
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 3306;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("MySQL connection URL port is invalid.");
  }

  const database = decodeUrlComponent(parsed.pathname.replace(/^\/+/, ""));
  const user = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);
  const sslMode = mysqlSslModeFromUrl(parsed.searchParams.get("ssl")) ?? input.sslMode;
  const derivedName = [database || input.database, host].filter(Boolean).join("@");

  return trimConnectionFields({
    ...input,
    engine: "mysql",
    name: input.name.trim() || derivedName || host,
    host,
    port,
    database: database || input.database,
    filePath: undefined,
    user: user || input.user,
    password: input.password || password,
    sslMode,
    connectionUrl: undefined
  });
}

function normalizeSqliteUrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  const filePath = decodeUrlComponent(`${parsed.hostname ? `/${parsed.hostname}` : ""}${parsed.pathname}`).trim();
  if (!filePath || filePath === "/") {
    throw new Error("SQLite connection URL must include a database file path.");
  }

  return trimConnectionFields({
    ...input,
    engine: "sqlite",
    name: input.name.trim() || basename(filePath),
    host: "",
    port: 0,
    database: basename(filePath),
    filePath,
    user: "",
    password: "",
    sslMode: "disable",
    savePassword: false,
    connectionUrl: undefined
  });
}

function normalizeTursoUrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  if (!parsed.hostname) {
    throw new Error("Turso connection URL must include a host.");
  }

  const authToken = parsed.searchParams.get("authToken") ?? parsed.searchParams.get("auth_token") ?? "";
  parsed.searchParams.delete("authToken");
  parsed.searchParams.delete("auth_token");
  const endpoint = parsed.toString();
  const database = tursoDatabaseName(parsed) || input.database.trim();

  return trimConnectionFields({
    ...input,
    engine: "turso",
    name: input.name.trim() || database || parsed.hostname,
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 0,
    database,
    filePath: undefined,
    endpoint,
    accountId: undefined,
    databaseId: undefined,
    user: "",
    password: input.password || authToken,
    sslMode: "require",
    connectionUrl: undefined
  });
}

function normalizeD1UrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  const accountId = decodeUrlComponent(parsed.hostname).trim();
  const databaseId = decodeUrlComponent(parsed.pathname.replace(/^\/+/, "")).trim();
  if (!accountId) {
    throw new Error("Cloudflare D1 connection URL must include an account ID.");
  }
  if (!databaseId) {
    throw new Error("Cloudflare D1 connection URL must include a database ID.");
  }

  const apiToken = parsed.searchParams.get("apiToken") ?? parsed.searchParams.get("api_token") ?? "";
  const database = databaseId || input.database.trim();

  return trimConnectionFields({
    ...input,
    engine: "cloudflare-d1",
    name: input.name.trim() || database,
    host: "",
    port: 0,
    database,
    filePath: undefined,
    endpoint: undefined,
    accountId,
    databaseId,
    user: "",
    password: input.password || apiToken,
    sslMode: "require",
    connectionUrl: undefined
  });
}

function normalizeS3UrlInput(input: ConnectionInput, parsed: URL): ConnectionInput {
  const bucket = decodeUrlComponent(parsed.hostname).trim();
  const endpoint = parsed.searchParams.get("endpoint")?.trim() || "";
  const accessKeyId = decodeUrlComponent(parsed.username).trim();
  const secretAccessKey = decodeUrlComponent(parsed.password);
  if (!bucket) {
    throw new Error("S3-compatible connection URL must include a bucket.");
  }
  if (!endpoint) {
    throw new Error("S3-compatible connection URL must include an endpoint query parameter.");
  }
  if (!accessKeyId) {
    throw new Error("S3-compatible connection URL must include an access key ID.");
  }
  if (!input.password && !secretAccessKey) {
    throw new Error("S3-compatible connection requires a secret access key.");
  }

  return normalizeS3ConnectionInput({
    ...input,
    kind: "storage",
    engine: "s3-compatible",
    name: input.name.trim() || bucket,
    host: "",
    port: 0,
    database: "",
    filePath: undefined,
    endpoint,
    bucket,
    region: parsed.searchParams.get("region") || input.region || "us-east-1",
    accessKeyId,
    sessionToken: parsed.searchParams.get("sessionToken") || input.sessionToken,
    rootPrefix: parsed.searchParams.get("rootPrefix") || input.rootPrefix,
    forcePathStyle: parseBooleanParam(parsed.searchParams.get("forcePathStyle"), input.forcePathStyle ?? true),
    user: "",
    password: input.password || secretAccessKey,
    sslMode: "require",
    connectionUrl: undefined
  });
}

function normalizeManualConnectionInput(input: ConnectionInput): ConnectionInput {
  const engine = input.engine ?? "postgresql";

  if (engine === "sqlite") {
    const filePath = input.filePath?.trim() || input.database.trim();
    if (!filePath) {
      throw new Error("SQLite database file path is required.");
    }

    return trimConnectionFields({
      ...input,
      engine,
      name: input.name.trim() || basename(filePath),
      host: "",
      port: 0,
      database: basename(filePath),
      filePath,
      endpoint: undefined,
      accountId: undefined,
      databaseId: undefined,
      user: "",
      password: "",
      sslMode: "disable",
      savePassword: false
    });
  }

  if (engine === "turso") {
    const endpoint = input.endpoint?.trim() || input.host.trim();
    if (!endpoint) {
      throw new Error("Turso database URL is required.");
    }

    const database = input.database.trim() || tursoDatabaseNameFromEndpoint(endpoint);
    return trimConnectionFields({
      ...input,
      engine,
      name: input.name.trim() || database || endpoint,
      host: "",
      port: 0,
      database,
      filePath: undefined,
      endpoint,
      accountId: undefined,
      databaseId: undefined,
      user: "",
      sslMode: "require"
    });
  }

  if (engine === "cloudflare-d1") {
    const accountId = input.accountId?.trim() || input.host.trim();
    const databaseId = input.databaseId?.trim() || input.database.trim();
    if (!accountId) {
      throw new Error("Cloudflare D1 account ID is required.");
    }
    if (!databaseId) {
      throw new Error("Cloudflare D1 database ID is required.");
    }

    return trimConnectionFields({
      ...input,
      engine,
      name: input.name.trim() || databaseId,
      host: "",
      port: 0,
      database: input.database.trim() || databaseId,
      filePath: undefined,
      endpoint: undefined,
      accountId,
      databaseId,
      user: "",
      sslMode: "require"
    });
  }

  if (engine === "s3-compatible") {
    return normalizeS3ConnectionInput({
      ...input,
      kind: "storage",
      engine
    });
  }

  return trimConnectionFields({
    ...input,
    kind: "database",
    engine,
    port: input.port || (engine === "mysql" ? 3306 : 5432)
  });
}

function normalizeS3ConnectionInput(input: ConnectionInput): ConnectionInput {
  const endpoint = input.endpoint?.trim() || "";
  const bucket = input.bucket?.trim() || "";
  const region = input.region?.trim() || "us-east-1";
  const accessKeyId = input.accessKeyId?.trim() || "";
  const password = input.password ?? "";
  validateHttpEndpoint(endpoint);
  if (!bucket) {
    throw new Error("S3-compatible bucket is required.");
  }
  if (!accessKeyId) {
    throw new Error("S3-compatible access key ID is required.");
  }
  if (!password) {
    throw new Error("S3-compatible connection requires a secret access key.");
  }

  return trimConnectionFields({
    ...input,
    kind: "storage",
    engine: "s3-compatible",
    name: input.name.trim() || bucket,
    host: "",
    port: 0,
    database: "",
    filePath: undefined,
    endpoint,
    bucket,
    region,
    accessKeyId,
    sessionToken: input.sessionToken?.trim() || undefined,
    rootPrefix: normalizeRootPrefix(input.rootPrefix),
    forcePathStyle: input.forcePathStyle ?? true,
    user: "",
    sslMode: "require"
  });
}

function trimConnectionFields(input: ConnectionInput): ConnectionInput {
  const engine = input.engine ?? "postgresql";
  return {
    ...input,
    kind: input.kind ?? (engine === "s3-compatible" ? "storage" : "database"),
    engine,
    name: input.name.trim(),
    host: input.host.trim(),
    database: input.database.trim(),
    filePath: input.filePath?.trim() || undefined,
    endpoint: input.endpoint?.trim() || undefined,
    accountId: input.accountId?.trim() || undefined,
    databaseId: input.databaseId?.trim() || undefined,
    bucket: input.bucket?.trim() || undefined,
    region: input.region?.trim() || undefined,
    accessKeyId: input.accessKeyId?.trim() || undefined,
    sessionToken: input.sessionToken?.trim() || undefined,
    rootPrefix: normalizeRootPrefix(input.rootPrefix),
    forcePathStyle: input.forcePathStyle,
    user: input.user.trim(),
    connectionUrl: input.connectionUrl?.trim() || undefined
  };
}

function sslModeFromUrl(sslMode: string | null): SslMode | undefined {
  if (sslMode === "disable" || sslMode === "prefer" || sslMode === "require") {
    return sslMode;
  }

  if (sslMode === "verify-ca" || sslMode === "verify-full") {
    return "require";
  }

  return undefined;
}

function mysqlSslModeFromUrl(ssl: string | null): SslMode | undefined {
  if (!ssl) {
    return undefined;
  }

  if (ssl === "false" || ssl === "0" || ssl === "disable") {
    return "disable";
  }

  if (ssl === "prefer") {
    return "prefer";
  }

  return "require";
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

function encodeSqlitePath(filePath: string): string {
  return encodeURI(filePath.startsWith("/") ? filePath : `/${filePath}`);
}

function formatConnectionUrlHost(host: string): string {
  const normalizedHost = stripIpv6Brackets(host.trim());
  return normalizedHost.includes(":") ? `[${normalizedHost}]` : normalizedHost;
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function validateHttpEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("S3-compatible endpoint URL is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("S3-compatible endpoint URL must start with http:// or https://.");
  }
}

function normalizeRootPrefix(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `${normalized}/` : undefined;
}

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  return value === "true" || value === "1";
}

function tursoDatabaseName(parsed: URL): string {
  const firstHostPart = parsed.hostname.split(".")[0] ?? "";
  return firstHostPart.replace(/-[a-z0-9]+$/i, "") || firstHostPart || parsed.hostname;
}

function tursoDatabaseNameFromEndpoint(endpoint: string): string {
  try {
    return tursoDatabaseName(new URL(endpoint));
  } catch {
    return "";
  }
}

function basename(filePath: string): string {
  return (
    filePath
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() || filePath
  );
}

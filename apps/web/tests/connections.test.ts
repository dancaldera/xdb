import { describe, expect, test } from "vitest";
import { buildConnectionString, normalizeConnectionInput } from "../src/shared/connections";
import type { ConnectionInput } from "../src/shared/types";

const BASE_INPUT: ConnectionInput = {
  name: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "",
  sslMode: "disable",
  color: "#3b82f6",
  savePassword: true
};

describe("connection input normalization", () => {
  test("builds a connection profile from a Postgres URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl: "postgresql://ada:s3cret@db.example.com:6543/app_db?sslmode=require"
    });

    expect(normalized.name).toBe("app_db@db.example.com");
    expect(normalized.engine).toBe("postgresql");
    expect(normalized.host).toBe("db.example.com");
    expect(normalized.port).toBe(6543);
    expect(normalized.database).toBe("app_db");
    expect(normalized.user).toBe("ada");
    expect(normalized.password).toBe("s3cret");
    expect(normalized.sslMode).toBe("require");
    expect(normalized.connectionUrl).toBeUndefined();
  });

  test("keeps an explicit name and maps verify ssl modes to require", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      name: "Production",
      connectionUrl: "postgres://app@db.example.com/service?sslmode=verify-full"
    });

    expect(normalized.name).toBe("Production");
    expect(normalized.sslMode).toBe("require");
  });

  test("keeps the selected SSL mode when a URL does not include sslmode", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      sslMode: "prefer",
      connectionUrl: "postgres://app@db.example.com/service"
    });

    expect(normalized.sslMode).toBe("prefer");
  });

  test("rejects unsupported URLs", () => {
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        connectionUrl: "redis://localhost/0"
      })
    ).toThrow("postgres://, postgresql://, mysql://, sqlite://, libsql://, https://, d1://, or s3+https://");
  });

  test("defaults manual profiles to PostgreSQL", () => {
    const normalized = normalizeConnectionInput(BASE_INPUT);

    expect(normalized.engine).toBe("postgresql");
  });

  test("builds a connection profile from a MySQL URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl: "mysql://root:s3cret@db.example.com:3307/app_db?ssl=true"
    });

    expect(normalized.name).toBe("app_db@db.example.com");
    expect(normalized.engine).toBe("mysql");
    expect(normalized.host).toBe("db.example.com");
    expect(normalized.port).toBe(3307);
    expect(normalized.database).toBe("app_db");
    expect(normalized.user).toBe("root");
    expect(normalized.password).toBe("s3cret");
    expect(normalized.sslMode).toBe("require");
  });

  test("builds a SQLite connection profile from a file path", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      engine: "sqlite",
      name: "",
      host: "",
      port: 0,
      database: "",
      filePath: "/tmp/xdb/app.sqlite",
      user: "",
      sslMode: "disable"
    });

    expect(normalized.name).toBe("app.sqlite");
    expect(normalized.engine).toBe("sqlite");
    expect(normalized.database).toBe("app.sqlite");
    expect(normalized.filePath).toBe("/tmp/xdb/app.sqlite");
    expect(normalized.host).toBe("");
    expect(normalized.port).toBe(0);
    expect(normalized.user).toBe("");
  });

  test("builds a SQLite connection profile from a URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl: "sqlite:///tmp/xdb/app.sqlite"
    });

    expect(normalized.engine).toBe("sqlite");
    expect(normalized.database).toBe("app.sqlite");
    expect(normalized.filePath).toBe("/tmp/xdb/app.sqlite");
  });

  test("rejects SQLite profiles without a file path", () => {
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        engine: "sqlite",
        host: "",
        port: 0,
        database: "",
        user: ""
      })
    ).toThrow("SQLite database file path is required");
  });

  test("builds a Turso connection profile from manual fields", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      engine: "turso",
      name: "",
      host: "",
      port: 0,
      database: "",
      endpoint: "libsql://app-org.turso.io",
      user: "",
      password: "turso-token",
      sslMode: "require"
    });

    expect(normalized.name).toBe("app");
    expect(normalized.engine).toBe("turso");
    expect(normalized.endpoint).toBe("libsql://app-org.turso.io");
    expect(normalized.database).toBe("app");
    expect(normalized.password).toBe("turso-token");
    expect(normalized.host).toBe("");
    expect(normalized.port).toBe(0);
    expect(normalized.user).toBe("");
  });

  test("builds a Turso connection profile from a URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl: "libsql://app-org.turso.io?authToken=turso-token"
    });

    expect(normalized.engine).toBe("turso");
    expect(normalized.endpoint).toBe("libsql://app-org.turso.io");
    expect(normalized.database).toBe("app");
    expect(normalized.password).toBe("turso-token");
  });

  test("builds a Cloudflare D1 connection profile from manual fields", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      engine: "cloudflare-d1",
      name: "",
      host: "",
      port: 0,
      database: "",
      accountId: "account123",
      databaseId: "database456",
      user: "",
      password: "api-token",
      sslMode: "require"
    });

    expect(normalized.name).toBe("database456");
    expect(normalized.engine).toBe("cloudflare-d1");
    expect(normalized.accountId).toBe("account123");
    expect(normalized.databaseId).toBe("database456");
    expect(normalized.database).toBe("database456");
    expect(normalized.password).toBe("api-token");
    expect(normalized.host).toBe("");
    expect(normalized.port).toBe(0);
    expect(normalized.user).toBe("");
  });

  test("builds a Cloudflare D1 connection profile from a URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl: "d1://account123/database456?apiToken=api-token"
    });

    expect(normalized.engine).toBe("cloudflare-d1");
    expect(normalized.accountId).toBe("account123");
    expect(normalized.databaseId).toBe("database456");
    expect(normalized.database).toBe("database456");
    expect(normalized.password).toBe("api-token");
  });

  test("builds an S3-compatible connection profile from manual fields", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      engine: "s3-compatible",
      name: "",
      host: "",
      port: 0,
      database: "",
      endpoint: "https://s3.example.com",
      bucket: "assets",
      region: "",
      accessKeyId: "access-key",
      password: "secret-key",
      rootPrefix: "/photos",
      user: ""
    });

    expect(normalized.kind).toBe("storage");
    expect(normalized.engine).toBe("s3-compatible");
    expect(normalized.name).toBe("assets");
    expect(normalized.endpoint).toBe("https://s3.example.com");
    expect(normalized.bucket).toBe("assets");
    expect(normalized.region).toBe("us-east-1");
    expect(normalized.accessKeyId).toBe("access-key");
    expect(normalized.password).toBe("secret-key");
    expect(normalized.rootPrefix).toBe("photos/");
    expect(normalized.forcePathStyle).toBe(true);
    expect(normalized.user).toBe("");
  });

  test("builds an S3-compatible connection profile from a URL", () => {
    const normalized = normalizeConnectionInput({
      ...BASE_INPUT,
      connectionUrl:
        "s3+https://access-key:secret-key@assets?endpoint=https%3A%2F%2Fs3.example.com&region=auto&forcePathStyle=false&rootPrefix=photos%2F&sessionToken=session"
    });

    expect(normalized.kind).toBe("storage");
    expect(normalized.engine).toBe("s3-compatible");
    expect(normalized.endpoint).toBe("https://s3.example.com");
    expect(normalized.bucket).toBe("assets");
    expect(normalized.region).toBe("auto");
    expect(normalized.accessKeyId).toBe("access-key");
    expect(normalized.password).toBe("secret-key");
    expect(normalized.rootPrefix).toBe("photos/");
    expect(normalized.forcePathStyle).toBe(false);
    expect(normalized.sessionToken).toBe("session");
  });

  test("rejects incomplete S3-compatible profiles", () => {
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        engine: "s3-compatible",
        endpoint: "",
        bucket: "assets",
        accessKeyId: "access-key",
        password: "secret-key"
      })
    ).toThrow("endpoint URL is invalid");
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        engine: "s3-compatible",
        endpoint: "https://s3.example.com",
        bucket: "",
        accessKeyId: "access-key",
        password: "secret-key"
      })
    ).toThrow("bucket is required");
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        engine: "s3-compatible",
        endpoint: "https://s3.example.com",
        bucket: "assets",
        accessKeyId: "",
        password: "secret-key"
      })
    ).toThrow("access key ID is required");
    expect(() =>
      normalizeConnectionInput({
        ...BASE_INPUT,
        engine: "s3-compatible",
        endpoint: "https://s3.example.com",
        bucket: "assets",
        accessKeyId: "access-key",
        password: ""
      })
    ).toThrow("secret access key");
  });
});

describe("connection string formatting", () => {
  test("builds a complete Postgres connection string", () => {
    expect(
      buildConnectionString({
        host: "db.example.com",
        engine: "postgresql",
        port: 6543,
        database: "app_db",
        user: "ada",
        password: "s3cret",
        sslMode: "require"
      })
    ).toBe("postgresql://ada:s3cret@db.example.com:6543/app_db?sslmode=require");
  });

  test("encodes credentials and database names", () => {
    expect(
      buildConnectionString({
        host: "db.example.com",
        engine: "postgresql",
        port: 5432,
        database: "app/db",
        user: "ada@example.com",
        password: "p@ss word/with:chars",
        sslMode: "prefer"
      })
    ).toBe("postgresql://ada%40example.com:p%40ss%20word%2Fwith%3Achars@db.example.com:5432/app%2Fdb?sslmode=prefer");
  });

  test("wraps IPv6 hosts in brackets", () => {
    expect(
      buildConnectionString({
        host: "2001:db8::1",
        engine: "postgresql",
        port: 5432,
        database: "postgres",
        user: "postgres",
        password: "",
        sslMode: "disable"
      })
    ).toBe("postgresql://postgres@[2001:db8::1]:5432/postgres?sslmode=disable");
  });

  test("builds a MySQL connection string", () => {
    expect(
      buildConnectionString({
        engine: "mysql",
        host: "db.example.com",
        port: 3306,
        database: "app_db",
        user: "root",
        password: "s3cret",
        sslMode: "require"
      })
    ).toBe("mysql://root:s3cret@db.example.com:3306/app_db?ssl=require");
  });

  test("builds a SQLite connection string", () => {
    expect(
      buildConnectionString({
        engine: "sqlite",
        host: "",
        port: 0,
        database: "app.sqlite",
        filePath: "/tmp/xdb/app.sqlite",
        user: "",
        password: "",
        sslMode: "disable"
      })
    ).toBe("sqlite:///tmp/xdb/app.sqlite");
  });

  test("builds a Turso connection string", () => {
    expect(
      buildConnectionString({
        engine: "turso",
        host: "",
        port: 0,
        database: "app",
        endpoint: "libsql://app-org.turso.io",
        user: "",
        password: "turso-token",
        sslMode: "require"
      })
    ).toBe("libsql://app-org.turso.io?authToken=turso-token");
  });

  test("builds a Cloudflare D1 connection string", () => {
    expect(
      buildConnectionString({
        engine: "cloudflare-d1",
        host: "",
        port: 0,
        database: "database456",
        accountId: "account123",
        databaseId: "database456",
        user: "",
        password: "api-token",
        sslMode: "require"
      })
    ).toBe("d1://account123/database456?apiToken=api-token");
  });

  test("builds an S3-compatible connection string", () => {
    expect(
      buildConnectionString({
        engine: "s3-compatible",
        host: "",
        port: 0,
        database: "",
        endpoint: "https://s3.example.com",
        bucket: "assets",
        region: "auto",
        accessKeyId: "access-key",
        password: "secret-key",
        rootPrefix: "photos/",
        forcePathStyle: false,
        user: "",
        sslMode: "require"
      })
    ).toBe(
      "s3+https://access-key:secret-key@assets?endpoint=https%3A%2F%2Fs3.example.com&region=auto&forcePathStyle=false&rootPrefix=photos%2F"
    );
  });
});

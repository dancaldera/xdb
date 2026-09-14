import { describe, expect, test } from "vitest";
import {
  createConnectionArchive,
  createConnectionArchiveCopies,
  parseConnectionArchive
} from "../src/shared/connection-archive";
import type { ConnectionGroup, ConnectionProfile } from "../src/shared/types";

const group: ConnectionGroup = {
  id: "group-1",
  name: "Production",
  color: "#242d64",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const profile: ConnectionProfile = {
  id: "profile-1",
  kind: "database",
  engine: "postgresql",
  groupId: group.id,
  name: "Primary",
  host: "db.example.com",
  port: 5432,
  database: "app",
  user: "postgres",
  password: "secret",
  sslMode: "require",
  color: "#3b82f6",
  savePassword: true,
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("connection archives", () => {
  test("creates safe exports without passwords or tokens", () => {
    const archive = createConnectionArchive({
      includeSecrets: false,
      groups: [group],
      connections: [profile],
      exportedAt: "2026-02-01T00:00:00.000Z"
    });

    expect(archive.includeSecrets).toBe(false);
    expect(archive.exportedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(archive.connections[0].password).toBeUndefined();
    expect(archive.connections[0].savePassword).toBe(false);
    expect(archive.connections[0].hasPassword).toBe(false);
  });

  test("creates complete exports with saved secrets", () => {
    const archive = createConnectionArchive({
      includeSecrets: true,
      groups: [group],
      connections: [profile]
    });

    expect(archive.includeSecrets).toBe(true);
    expect(archive.connections[0].password).toBe("secret");
    expect(archive.connections[0].savePassword).toBe(true);
    expect(archive.connections[0].hasPassword).toBe(true);
  });

  test("creates import copies with new ids and remapped groups", () => {
    const archive = createConnectionArchive({
      includeSecrets: true,
      groups: [group],
      connections: [profile]
    });
    const ids = ["new-group", "new-profile"];

    const copies = createConnectionArchiveCopies(archive, {
      idProvider: () => ids.shift() ?? "fallback",
      now: "2026-03-01T00:00:00.000Z"
    });

    expect(copies.groups).toEqual([
      {
        ...group,
        id: "new-group",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z"
      }
    ]);
    expect(copies.connections[0]).toMatchObject({
      id: "new-profile",
      groupId: "new-group",
      name: "Primary",
      password: "secret",
      savePassword: true,
      connectionUrl: undefined
    });
  });

  test("rejects malformed or unsupported archives", () => {
    expect(() => parseConnectionArchive({})).toThrow("Connection archive format must be a string");
    expect(() =>
      parseConnectionArchive({
        format: "pixql.connections",
        version: 2,
        exportedAt: "2026-02-01T00:00:00.000Z",
        includeSecrets: false,
        groups: [],
        connections: []
      })
    ).toThrow("version 2 is not supported");
    expect(() =>
      parseConnectionArchive({
        format: "pixql.connections",
        version: "1",
        exportedAt: "2026-02-01T00:00:00.000Z",
        includeSecrets: false,
        groups: [],
        connections: []
      })
    ).not.toThrow();
    expect(() =>
      parseConnectionArchive({
        format: "pixql.connections",
        version: 1,
        exportedAt: "2026-02-01T00:00:00.000Z",
        includeSecrets: false,
        groups: [],
        connections: [{ ...profile, engine: "redis" }]
      })
    ).toThrow("Connection engine is invalid");
  });
});

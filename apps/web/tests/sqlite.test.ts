import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteService } from "../src/main/database";
import type { AppStore } from "../src/main/store";
import type { ConnectionProfile, QueryHistoryItem } from "../src/shared/types";

class FakeStore {
  history: QueryHistoryItem[] = [];

  constructor(private readonly profile: ConnectionProfile) {}

  async getConnection(profileId: string): Promise<ConnectionProfile | null> {
    return profileId === this.profile.id ? this.profile : null;
  }

  async addHistory(item: QueryHistoryItem): Promise<void> {
    this.history.unshift(item);
  }
}

describe("SQLite adapter", () => {
  let tempDir = "";
  let service: SqliteService;
  let store: FakeStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xdb-sqlite-"));
    const filePath = join(tempDir, "app.sqlite");
    const profile: ConnectionProfile = {
      id: "sqlite-profile",
      kind: "database",
      engine: "sqlite",
      name: "SQLite Test",
      host: "",
      port: 0,
      database: "app.sqlite",
      filePath,
      user: "",
      password: "",
      sslMode: "disable",
      color: "#242d64",
      savePassword: false,
      hasPassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store = new FakeStore(profile);
    service = new SqliteService(store as unknown as AppStore);
    await service.connect(profile.id);
  });

  afterEach(async () => {
    await service.closeAll();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("connects, executes SQL, browses structure, and edits rows", async () => {
    await service.executeQuery(
      "sqlite-profile",
      "create table users (id integer primary key autoincrement, name text not null, email text)"
    );
    await service.insertRow({
      profileId: "sqlite-profile",
      schema: "main",
      table: "users",
      values: { name: "Ada", email: "ada@example.com" }
    });

    const objects = await service.listObjects("sqlite-profile");
    expect(objects).toEqual([{ schema: "main", name: "users", type: "base_table", estimatedRows: null }]);

    const structure = await service.getTableStructure("sqlite-profile", "main", "users");
    expect(structure.primaryKeys).toEqual(["id"]);
    expect(structure.columns.map((column) => column.name)).toEqual(["id", "name", "email"]);
    expect(structure.columns.find((column) => column.name === "id")?.isPrimaryKey).toBe(true);

    let data = await service.getTableData("sqlite-profile", "main", "users", 1, 100);
    expect(data.rows).toEqual([{ id: 1, name: "Ada", email: "ada@example.com" }]);
    expect(store.history[0]).toMatchObject({
      source: "table-data",
      target: { schema: "main", table: "users", action: "select" },
      command: "SELECT",
      rowCount: 1
    });
    expect(store.history[0]?.sql).toBe('select * from "main"."users" limit 100 offset 0');

    await service.updateRow({
      profileId: "sqlite-profile",
      schema: "main",
      table: "users",
      key: { id: 1 },
      values: { name: "Grace" }
    });
    expect(store.history[0]).toMatchObject({
      source: "row-edit",
      target: { schema: "main", table: "users", action: "update" },
      command: "UPDATE",
      rowCount: 1
    });
    data = await service.getTableData("sqlite-profile", "main", "users", 1, 100, {
      rules: [{ id: "1", enabled: true, column: "name", operator: "contains", value: "gra" }]
    });
    expect(data.rows).toEqual([{ id: 1, name: "Grace", email: "ada@example.com" }]);
    expect(store.history[0]?.sql).toBe(
      'select * from "main"."users" where lower(cast("name" as text)) like lower(\'%gra%\') escape \'\\\' limit 100 offset 0'
    );

    const result = await service.executeQuery("sqlite-profile", "select name from users where id = 1");
    expect(result.rows).toEqual([{ name: "Grace" }]);
    expect(result.fields.map((field) => field.name)).toEqual(["name"]);
    expect(store.history[0]).toMatchObject({
      source: "query-editor",
      command: "SELECT"
    });

    await service.deleteRow({
      profileId: "sqlite-profile",
      schema: "main",
      table: "users",
      key: { id: 1 }
    });
    expect(store.history[0]).toMatchObject({
      source: "row-edit",
      target: { schema: "main", table: "users", action: "delete" },
      command: "DELETE",
      rowCount: 1
    });
    data = await service.getTableData("sqlite-profile", "main", "users", 1, 100);
    expect(data.rows).toEqual([]);
    expect(store.history[0]).toMatchObject({
      source: "table-data",
      target: { schema: "main", table: "users", action: "select" },
      rowCount: 0
    });
    expect(store.history.length).toBeGreaterThanOrEqual(7);
  });
});

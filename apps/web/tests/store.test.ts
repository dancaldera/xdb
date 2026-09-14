import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConnectionPickerLayout, QueryHistoryItem } from "../src/shared/types";

type AppStoreModule = typeof import("../src/main/store");

describe("AppStore connection picker layout", () => {
  let tempDir: string;
  let AppStore: AppStoreModule["AppStore"];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xdb-store-"));

    const storeModule = await import("../src/main/store");
    AppStore = storeModule.AppStore;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns null when no layout has been saved", async () => {
    const store = new AppStore(tempDir);

    const layout = await store.getConnectionPickerLayout();

    expect(layout).toBeNull();
  });

  test("saves and retrieves connection picker layout", async () => {
    const store = new AppStore(tempDir);
    const layout: ConnectionPickerLayout = {
      collapsedGroupIds: ["group-a"],
      groupOrder: ["group-b", "group-a"],
      connectionOrder: {
        "group-a": ["conn-2", "conn-1"],
        "group-b": ["conn-3"]
      },
      scrollTop: 124
    };

    await store.saveConnectionPickerLayout(layout);
    const stored = await store.getConnectionPickerLayout();

    expect(stored).toEqual(layout);

    const raw = await readFile(join(tempDir, "xdb-state.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.connectionPickerLayout).toEqual(layout);
  });

  test("sanitizes malformed layout values on save", async () => {
    const store = new AppStore(tempDir);
    const malformed = {
      collapsedGroupIds: ["group-a", 123, null],
      groupOrder: ["group-a", "group-b", true],
      connectionOrder: {
        "group-a": ["conn-1", 456],
        "group-b": "not-an-array"
      }
    } as unknown as ConnectionPickerLayout;

    const saved = await store.saveConnectionPickerLayout(malformed);

    expect(saved.collapsedGroupIds).toEqual(["group-a"]);
    expect(saved.groupOrder).toEqual(["group-a", "group-b"]);
    expect(saved.connectionOrder).toEqual({
      "group-a": ["conn-1"]
    });
  });

  test("drops non-finite scrollTop values", async () => {
    const store = new AppStore(tempDir);

    const saved = await store.saveConnectionPickerLayout({
      collapsedGroupIds: [],
      groupOrder: [],
      connectionOrder: {},
      scrollTop: NaN
    });

    expect(saved.scrollTop).toBeUndefined();
  });

  test("returns null when stored layout is malformed", async () => {
    const store = new AppStore(tempDir);
    await store.saveConnectionPickerLayout({
      collapsedGroupIds: [],
      groupOrder: [],
      connectionOrder: {}
    });

    const raw = await readFile(join(tempDir, "xdb-state.json"), "utf8");
    const parsed = JSON.parse(raw);
    parsed.connectionPickerLayout = "not-an-object";
    const corrupted = JSON.stringify(parsed);
    await writeFile(join(tempDir, "xdb-state.json"), corrupted);

    const retrieved = await store.getConnectionPickerLayout();
    expect(retrieved).toBeNull();
  });

  test("preserves concurrent history entries", async () => {
    const store = new AppStore(tempDir);
    const entries = Array.from({ length: 20 }, (_, index) => historyItem(`history-${index}`));

    await Promise.all(entries.map((entry) => store.addHistory(entry)));

    const history = await store.getHistory("profile-a");
    expect(history).toHaveLength(entries.length);
    expect(new Set(history.map((item) => item.id)).size).toBe(entries.length);
  });

  test("reads legacy history entries without source metadata", async () => {
    const legacyItem = historyItem("legacy");
    const { source: _source, target: _target, ...legacyHistoryItem } = legacyItem;
    await writeFile(
      join(tempDir, "xdb-state.json"),
      JSON.stringify({ connections: [], groups: [], history: [legacyHistoryItem] }),
      "utf8"
    );

    const store = new AppStore(tempDir);
    const history = await store.getHistory("profile-a");

    expect(history).toEqual([legacyHistoryItem]);
  });

  test("saves, updates, lists, and deletes saved queries by connection", async () => {
    const store = new AppStore(tempDir);

    const first = await store.saveSavedQuery({
      profileId: "profile-a",
      name: "List users",
      sql: "select * from users"
    });
    await store.saveSavedQuery({
      profileId: "profile-b",
      name: "List products",
      sql: "select * from products"
    });
    const updated = await store.saveSavedQuery({
      id: first.id,
      profileId: "profile-a",
      name: "List active users",
      sql: "select * from users where active = true"
    });

    expect(updated.id).toBe(first.id);
    expect(await store.listSavedQueries("profile-a")).toEqual([updated]);
    expect(await store.listSavedQueries("profile-b")).toHaveLength(1);

    await store.deleteSavedQuery(first.id);
    expect(await store.listSavedQueries("profile-a")).toEqual([]);
  });

  test("persists and restores SQL drafts by connection", async () => {
    const store = new AppStore(tempDir);

    const draft = await store.saveSqlDraft("profile-a", "select 1;");

    expect(await store.getSqlDraft("profile-a")).toEqual(draft);
    expect(await store.getSqlDraft("profile-b")).toBeNull();
  });

  test("deleting a connection removes related saved queries and draft", async () => {
    const store = new AppStore(tempDir);
    await store.saveConnection(connectionInput("profile-a"));
    await store.saveConnection(connectionInput("profile-b"));
    await store.saveSavedQuery({ profileId: "profile-a", name: "A", sql: "select 1" });
    await store.saveSavedQuery({ profileId: "profile-b", name: "B", sql: "select 2" });
    await store.saveSqlDraft("profile-a", "select 1;");
    await store.saveSqlDraft("profile-b", "select 2;");

    await store.deleteConnection("profile-a");

    expect(await store.listSavedQueries("profile-a")).toEqual([]);
    expect(await store.getSqlDraft("profile-a")).toBeNull();
    expect(await store.listSavedQueries("profile-b")).toHaveLength(1);
    expect(await store.getSqlDraft("profile-b")).toMatchObject({ sql: "select 2;" });
  });

  test("reads legacy state without saved query fields", async () => {
    await writeFile(
      join(tempDir, "xdb-state.json"),
      JSON.stringify({ connections: [], groups: [], history: [] }),
      "utf8"
    );

    const store = new AppStore(tempDir);

    expect(await store.listSavedQueries("profile-a")).toEqual([]);
    expect(await store.getSqlDraft("profile-a")).toBeNull();
  });
});

function historyItem(id: string): QueryHistoryItem {
  return {
    id,
    profileId: "profile-a",
    engine: "sqlite",
    database: "app.sqlite",
    sql: `select ${id}`,
    durationMs: 1,
    rowCount: 1,
    command: "SELECT",
    createdAt: new Date().toISOString(),
    source: "query-editor"
  };
}

function connectionInput(id: string) {
  return {
    id,
    kind: "database" as const,
    engine: "sqlite" as const,
    name: id,
    host: "",
    port: 0,
    database: `${id}.sqlite`,
    filePath: `/tmp/${id}.sqlite`,
    user: "",
    password: "",
    sslMode: "disable" as const,
    color: "#242d64",
    savePassword: false
  };
}

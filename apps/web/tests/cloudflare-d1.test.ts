import { afterEach, describe, expect, test } from "vitest";
import { CloudflareD1Service, createD1QueryExecutionResult, executeCloudflareD1Query } from "../src/main/database";
import type { AppStore } from "../src/main/store";
import type { ConnectionProfile } from "../src/shared/types";

const originalFetch = globalThis.fetch;

const profile: ConnectionProfile & { password: string } = {
  id: "d1-profile",
  kind: "database",
  engine: "cloudflare-d1",
  name: "D1",
  host: "",
  port: 0,
  database: "database456",
  accountId: "account123",
  databaseId: "database456",
  user: "",
  password: "api-token",
  sslMode: "require",
  color: "#242d64",
  savePassword: true,
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

class FakeStore {
  history = [];

  constructor(private readonly connection: ConnectionProfile) {}

  async getConnection(profileId: string): Promise<ConnectionProfile | null> {
    return profileId === this.connection.id ? this.connection : null;
  }

  async addHistory(): Promise<void> {}
}

describe("Cloudflare D1 adapter helpers", () => {
  test("connects with a D1-safe select probe", async () => {
    let requestedBody: unknown = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          success: true,
          result: [{ success: true, results: [{ ok: 1 }], meta: {} }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const service = new CloudflareD1Service(new FakeStore(profile) as unknown as AppStore);
    const status = await service.connect(profile.id);

    expect(requestedBody).toEqual({ sql: "select 1 as ok" });
    expect(status).toEqual({
      profileId: profile.id,
      engine: "cloudflare-d1",
      connected: true,
      database: "database456",
      serverVersion: "D1",
      currentUser: undefined
    });
  });

  test("executes D1 query requests and maps successful results", async () => {
    let requestedUrl = "";
    let requestedBody: unknown = null;
    let authorization = "";

    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(String(init?.body));
      authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization);
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              success: true,
              results: [{ id: 1, name: "Ada" }],
              meta: { timings: { sql_duration_ms: 7 }, changes: 0 }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await executeCloudflareD1Query(profile, "select * from users where id = ?", [1]);
    const mapped = createD1QueryExecutionResult(result, "select * from users", 99);

    expect(requestedUrl).toContain("/accounts/account123/d1/database/database456/query");
    expect(authorization).toBe("Bearer api-token");
    expect(requestedBody).toEqual({ sql: "select * from users where id = ?", params: [1] });
    expect(mapped.rows).toEqual([{ id: 1, name: "Ada" }]);
    expect(mapped.fields).toEqual([
      { name: "id", dataTypeID: 0 },
      { name: "name", dataTypeID: 0 }
    ]);
    expect(mapped.rowCount).toBe(1);
    expect(mapped.durationMs).toBe(7);
  });

  test("surfaces Cloudflare API errors", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: "Invalid API token" }] }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })) as unknown as typeof fetch;

    await expect(executeCloudflareD1Query(profile, "select 1")).rejects.toThrow("Invalid API token");
  });

  test("surfaces D1 query-level failures", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, result: [{ success: false, error: "no such table: users" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })) as unknown as typeof fetch;

    await expect(executeCloudflareD1Query(profile, "select * from users")).rejects.toThrow("no such table: users");
  });
});

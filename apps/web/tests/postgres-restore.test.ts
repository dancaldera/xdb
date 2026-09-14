import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type pg from "pg";
import { extractCopyTableName, isCustomFormatDump, restoreSqlFile } from "../src/main/postgres-restore";

class FakeClient {
  statements: string[] = [];
  copies: Array<{ sql: string; data: string }> = [];

  constructor(private readonly failOn?: string) {}

  query(input: unknown): unknown {
    if (typeof input === "string") {
      this.statements.push(input);
      if (this.failOn && input.includes(this.failOn)) {
        return Promise.reject(new Error(`forced failure on: ${this.failOn}`));
      }
      return Promise.resolve({ rows: [] });
    }

    const copy = { sql: (input as { text: string }).text, data: "" };
    this.copies.push(copy);
    return new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        copy.data += chunk.toString();
        callback();
      }
    });
  }

  asClient(): pg.ClientBase {
    return this as unknown as pg.ClientBase;
  }
}

async function withTempFile(content: string | Buffer, run: (filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "xdb-restore-test-"));
  const filePath = join(directory, "backup.sql");

  try {
    await writeFile(filePath, content);
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("isCustomFormatDump", () => {
  test("detects PGDMP archives", async () => {
    await withTempFile(Buffer.concat([Buffer.from("PGDMP"), Buffer.from([0x01, 0x0e])]), async (filePath) => {
      expect(await isCustomFormatDump(filePath)).toBe(true);
    });
  });

  test("rejects plain SQL files and short files", async () => {
    await withTempFile("-- XDB plain SQL backup\nSELECT 1;\n", async (filePath) => {
      expect(await isCustomFormatDump(filePath)).toBe(false);
    });
    await withTempFile("PG", async (filePath) => {
      expect(await isCustomFormatDump(filePath)).toBe(false);
    });
  });
});

describe("extractCopyTableName", () => {
  test("extracts qualified table names", () => {
    expect(extractCopyTableName("COPY public.users (id, name) FROM stdin;")).toBe("public.users");
    expect(extractCopyTableName('COPY "my schema"."my table" (c) FROM stdin;')).toBe("my schema.my table");
  });
});

describe("restoreSqlFile", () => {
  test("executes statements and streams copy data in order", async () => {
    const script = [
      "BEGIN;",
      "CREATE TABLE public.t (a text, b text);",
      "COPY public.t (a, b) FROM stdin;",
      "1\tone",
      "2\ttwo",
      "\\.",
      "COMMIT;",
      ""
    ].join("\n");

    const client = new FakeClient();
    const progress: Array<{ phase: string; table?: string }> = [];

    await withTempFile(script, async (filePath) => {
      await restoreSqlFile(client.asClient(), filePath, {
        onProgress: (update) => progress.push({ phase: update.phase, table: update.table })
      });
    });

    expect(client.statements).toEqual(["BEGIN;", "CREATE TABLE public.t (a text, b text);", "COMMIT;"]);
    expect(client.copies).toEqual([{ sql: "COPY public.t (a, b) FROM stdin;", data: "1\tone\n2\ttwo\n" }]);
    expect(progress).toContainEqual({ phase: "copying-data", table: "public.t" });
  });

  test("rolls back and rethrows on statement failure", async () => {
    const client = new FakeClient("CREATE TABLE public.bad");

    await withTempFile("BEGIN;\nCREATE TABLE public.bad (a text);\nCOMMIT;\n", async (filePath) => {
      await expect(restoreSqlFile(client.asClient(), filePath)).rejects.toThrow("forced failure");
    });

    expect(client.statements.at(-1)).toBe("ROLLBACK");
  });

  test("throws a cancellation error when the signal is aborted", async () => {
    const client = new FakeClient();
    const controller = new AbortController();
    controller.abort();

    await withTempFile("SELECT 1;\nSELECT 2;\n", async (filePath) => {
      await expect(restoreSqlFile(client.asClient(), filePath, { signal: controller.signal })).rejects.toThrow(
        "Restore cancelled."
      );
    });

    // No ROLLBACK after abort: the connection may be mid-COPY and the caller
    // destroys it, which rolls back server-side.
    expect(client.statements).toEqual([]);
  });
});

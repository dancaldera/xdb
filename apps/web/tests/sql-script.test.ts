import { describe, expect, test } from "vitest";
import { isCopyFromStdin, parseSqlScript, type SqlScriptEvent } from "../src/main/sql-script";

async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let index = 0; index < text.length; index += size) {
    yield text.slice(index, index + size);
  }
}

async function parse(text: string, chunkSize = text.length || 1): Promise<SqlScriptEvent[]> {
  const events: SqlScriptEvent[] = [];
  for await (const event of parseSqlScript(chunked(text, chunkSize))) {
    events.push(event);
  }
  return events;
}

function statements(events: SqlScriptEvent[]): string[] {
  return events.filter((event) => event.kind === "statement").map((event) => event.sql);
}

describe("isCopyFromStdin", () => {
  test("matches plain pg_dump copy statements", () => {
    expect(isCopyFromStdin("COPY public.users (id, name) FROM stdin;")).toBe(true);
    expect(isCopyFromStdin('copy "weird schema"."t" (c) from stdin;')).toBe(true);
  });

  test("rejects other copy statements", () => {
    expect(isCopyFromStdin("COPY public.users TO stdout;")).toBe(false);
    expect(isCopyFromStdin("COPY public.users FROM '/tmp/stdin.csv';")).toBe(false);
    expect(isCopyFromStdin("SELECT 'COPY x FROM stdin';")).toBe(false);
  });
});

describe("parseSqlScript", () => {
  test("splits simple statements", async () => {
    const events = await parse("SELECT 1;\nSELECT 2;\n");
    expect(statements(events)).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  test("emits a trailing statement without a semicolon", async () => {
    const events = await parse("SELECT 1;\nSELECT 2");
    expect(statements(events)).toEqual(["SELECT 1;", "SELECT 2"]);
  });

  test("ignores semicolons inside single quotes including escaped quotes", async () => {
    const events = await parse("INSERT INTO t VALUES ('a;b', 'it''s;fine');\n");
    expect(statements(events)).toEqual(["INSERT INTO t VALUES ('a;b', 'it''s;fine');"]);
  });

  test("handles backslash escapes only in E-strings", async () => {
    const events = await parse("SELECT E'a\\';b';\nSELECT 'a\\';SELECT 2;\n");
    expect(statements(events)).toEqual(["SELECT E'a\\';b';", "SELECT 'a\\';", "SELECT 2;"]);
  });

  test("ignores semicolons inside double-quoted identifiers", async () => {
    const events = await parse('CREATE TABLE "a;b" (id int);\n');
    expect(statements(events)).toEqual(['CREATE TABLE "a;b" (id int);']);
  });

  test("ignores semicolons inside dollar-quoted bodies", async () => {
    const script = "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN PERFORM 1; END; $fn$ LANGUAGE plpgsql;\n";
    const events = await parse(script);
    expect(statements(events)).toEqual([script.trim()]);
  });

  test("does not mistake positional parameters for dollar quotes", async () => {
    const events = await parse("PREPARE p AS SELECT $1; EXECUTE p(1);\n");
    expect(statements(events)).toEqual(["PREPARE p AS SELECT $1;", "EXECUTE p(1);"]);
  });

  test("ignores semicolons in line comments and nested block comments", async () => {
    const events = await parse("SELECT 1 -- not done;\n+ 2;\n/* outer ; /* inner ; */ still ; */ SELECT 3;\n");
    expect(statements(events)).toEqual([
      "SELECT 1 -- not done;\n+ 2;",
      "/* outer ; /* inner ; */ still ; */ SELECT 3;"
    ]);
  });

  test("drops comment-only and empty statements", async () => {
    const events = await parse("-- header\n\n;\n/* block */;\nSELECT 1;\n");
    expect(statements(events)).toEqual(["SELECT 1;"]);
  });

  test("skips psql meta-commands", async () => {
    const events = await parse("\\connect mydb\nSELECT 1;\n\\echo hi\nSELECT 2;\n");
    expect(statements(events)).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  test("parses copy blocks into start, chunks, and end", async () => {
    const script = [
      "CREATE TABLE t (a text, b text);",
      "COPY public.t (a, b) FROM stdin;",
      "1\tone; with 'quotes' and $tag$",
      "2\t\\N",
      "\\.",
      "SELECT 1;",
      ""
    ].join("\n");

    const events = await parse(script);
    expect(events[0]).toEqual({ kind: "statement", sql: "CREATE TABLE t (a text, b text);" });
    expect(events[1]).toEqual({ kind: "copy-start", sql: "COPY public.t (a, b) FROM stdin;" });
    const chunks = events.filter((event) => event.kind === "copy-chunk").map((event) => event.chunk);
    expect(chunks.join("")).toBe("1\tone; with 'quotes' and $tag$\n2\t\\N\n");
    expect(events.some((event) => event.kind === "copy-end")).toBe(true);
    expect(events[events.length - 1]).toEqual({ kind: "statement", sql: "SELECT 1;" });
  });

  test("treats an unterminated copy block as ending at EOF", async () => {
    const events = await parse("COPY t (a) FROM stdin;\nrow1\nrow2\n");
    const chunks = events.filter((event) => event.kind === "copy-chunk").map((event) => event.chunk);
    expect(chunks.join("")).toBe("row1\nrow2\n");
    expect(events[events.length - 1]).toEqual({ kind: "copy-end" });
  });

  test("produces identical output regardless of chunk boundaries", async () => {
    const script = [
      "-- dump header",
      "BEGIN;",
      "CREATE TABLE \"se;mi\" (v text DEFAULT 'a;b');",
      "CREATE FUNCTION f() RETURNS text AS $$ SELECT 'x;y'; $$ LANGUAGE sql;",
      'COPY public."se;mi" (v) FROM stdin;',
      "line one\twith\\ttabs",
      "\\.",
      "COMMIT;",
      ""
    ].join("\n");

    const whole = await parse(script);
    for (const size of [1, 2, 3, 7]) {
      expect(await parse(script, size)).toEqual(whole);
    }
  });
});

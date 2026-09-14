import { describe, expect, test } from "vitest";
import {
  formatCell,
  formatRowForClipboard,
  formatRowsForClipboard,
  parseCellInput,
  toCsv
} from "../src/renderer/lib/format";

describe("renderer formatting helpers", () => {
  test("formats null and object cells", () => {
    expect(formatCell(null)).toBe("NULL");
    expect(formatCell({ active: true })).toBe('{"active":true}');
  });

  test("parses common cell edit inputs", () => {
    expect(parseCellInput("NULL")).toBeNull();
    expect(parseCellInput("42")).toBe(42);
    expect(parseCellInput("true")).toBe(true);
    expect(parseCellInput('{"role":"admin"}')).toEqual({ role: "admin" });
  });

  test("exports CSV with escaped fields", () => {
    expect(toCsv([{ name: "Ada", note: "hello, world" }])).toBe('name,note\nAda,"hello, world"');
  });

  test("formats selected rows for clipboard formats", () => {
    const row = { id: 7, name: "Ada | Lovelace", note: "first\nprogrammer", active: true };
    const columns = ["id", "name", "note", "active"];

    expect(formatRowForClipboard("plain", { columns, row })).toBe(
      "id: 7\nname: Ada | Lovelace\nnote: first\nprogrammer\nactive: true"
    );
    expect(formatRowForClipboard("json", { columns, row })).toBe(JSON.stringify(row, null, 2));
    expect(formatRowForClipboard("markdown", { columns, row })).toBe(
      "| id | name | note | active |\n| --- | --- | --- | --- |\n| 7 | Ada \\| Lovelace | first<br>programmer | true |"
    );
    expect(formatRowForClipboard("csv", { columns, row })).toBe('7,Ada | Lovelace,"first\nprogrammer",true');
    expect(formatRowForClipboard("csvWithHeader", { columns, row })).toBe(
      'id,name,note,active\n7,Ada | Lovelace,"first\nprogrammer",true'
    );
    expect(formatRowForClipboard("insert", { columns, row, schema: "public", table: "people" })).toBe(
      'INSERT INTO "public"."people" ("id", "name", "note", "active") VALUES (7, \'Ada | Lovelace\', \'first\nprogrammer\', TRUE);'
    );
  });

  test("escapes HTML and SQL clipboard output", () => {
    const row = { title: `O'Reilly <Guide>`, meta: { pages: 2 } };
    const columns = ["title", "meta"];

    expect(formatRowForClipboard("html", { columns, row })).toContain("O&#39;Reilly &lt;Guide&gt;");
    expect(formatRowForClipboard("insert", { columns, row, schema: 'weird"schema', table: "books" })).toBe(
      `INSERT INTO "weird""schema"."books" ("title", "meta") VALUES ('O''Reilly <Guide>', '{"pages":2}');`
    );
  });

  test("formats multiple selected rows for clipboard formats", () => {
    const rows = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" }
    ];
    const columns = ["id", "name"];

    expect(formatRowsForClipboard("plain", { columns, rows })).toBe("id: 1\nname: Ada\n\nid: 2\nname: Grace");
    expect(formatRowsForClipboard("json", { columns, rows })).toBe(JSON.stringify(rows, null, 2));
    expect(formatRowsForClipboard("markdown", { columns, rows })).toBe(
      "| id | name |\n| --- | --- |\n| 1 | Ada |\n| 2 | Grace |"
    );
    expect(formatRowsForClipboard("csv", { columns, rows })).toBe("1,Ada\n2,Grace");
    expect(formatRowsForClipboard("csvWithHeader", { columns, rows })).toBe("id,name\n1,Ada\n2,Grace");
    expect(formatRowsForClipboard("insert", { columns, rows, schema: "public", table: "people" })).toBe(
      'INSERT INTO "public"."people" ("id", "name") VALUES (1, \'Ada\'), (2, \'Grace\');'
    );
  });
});

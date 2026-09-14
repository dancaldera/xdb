import { describe, expect, test } from "vitest";
import { createTursoQueryExecutionResult } from "../src/main/database";

describe("Turso adapter helpers", () => {
  test("maps libSQL result sets into PixQL query results", () => {
    const result = createTursoQueryExecutionResult(
      {
        columns: ["id", "name"],
        columnTypes: ["integer", "text"],
        rows: [
          {
            0: 1,
            1: "Ada",
            id: 1,
            name: "Ada",
            length: 2
          }
        ],
        rowsAffected: 0,
        lastInsertRowid: undefined,
        toJSON: () => ({})
      },
      "select * from users",
      12
    );

    expect(result).toEqual({
      rows: [{ id: 1, name: "Ada" }],
      fields: [
        { name: "id", dataTypeID: 1 },
        { name: "name", dataTypeID: 3 }
      ],
      rowCount: 1,
      command: "SELECT",
      durationMs: 12
    });
  });

  test("uses affected row count for write results", () => {
    const result = createTursoQueryExecutionResult(
      {
        columns: [],
        columnTypes: [],
        rows: [],
        rowsAffected: 2,
        lastInsertRowid: 12n,
        toJSON: () => ({})
      },
      "update users set active = 0",
      8
    );

    expect(result.rows).toEqual([]);
    expect(result.fields).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.command).toBe("UPDATE");
  });
});

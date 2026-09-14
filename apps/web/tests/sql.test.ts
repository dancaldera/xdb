import { describe, expect, test } from "vitest";
import type { TableColumn, TableFilterOperator } from "../src/shared/types";
import {
  buildCreateDatabaseSql,
  buildDeleteSql,
  buildDropDatabaseSql,
  buildFilteredCountTableSql,
  buildFilteredSelectTableSql,
  buildInsertSql,
  buildSelectTableSql,
  buildTableSortOrderSql,
  buildUpdateSql,
  formatSqlStatementForHistory,
  quoteIdentifier
} from "../src/main/sql";

const columns: TableColumn[] = [
  {
    name: "id",
    dataType: "integer",
    nullable: false,
    defaultValue: null,
    ordinalPosition: 1,
    maxLength: null,
    numericPrecision: 32,
    isPrimaryKey: true
  },
  {
    name: "name",
    dataType: "text",
    nullable: true,
    defaultValue: null,
    ordinalPosition: 2,
    maxLength: null,
    numericPrecision: null,
    isPrimaryKey: false
  },
  {
    name: "email",
    dataType: "text",
    nullable: true,
    defaultValue: null,
    ordinalPosition: 3,
    maxLength: null,
    numericPrecision: null,
    isPrimaryKey: false
  }
];

describe("SQL helpers", () => {
  test("quotes valid identifiers and rejects invalid identifiers", () => {
    expect(quoteIdentifier("users", "postgresql")).toBe('"users"');
    expect(quoteIdentifier("users", "mysql")).toBe("`users`");
    expect(quoteIdentifier("user_2026", "sqlite")).toBe('"user_2026"');
    expect(() => quoteIdentifier("users; drop table users")).toThrow("Invalid SQL identifier");
  });

  test("quotes PostgreSQL database names for create and drop statements", () => {
    expect(buildCreateDatabaseSql("harmony-v2")).toBe('create database "harmony-v2"');
    expect(buildDropDatabaseSql('customer"; drop database postgres; --')).toBe(
      'drop database "customer""; drop database postgres; --"'
    );
    expect(() => buildCreateDatabaseSql(" ")).toThrow("Database name is required");
    expect(() => buildDropDatabaseSql("a".repeat(64))).toThrow("at most 63 bytes");
  });

  test("builds paginated table select SQL per dialect", () => {
    expect(buildSelectTableSql("postgresql", "public", "users")).toBe(
      'select * from "public"."users" limit $1 offset $2'
    );
    expect(buildSelectTableSql("mysql", "app", "users")).toBe("select * from `app`.`users` limit ? offset ?");
    expect(buildSelectTableSql("sqlite", "main", "users")).toBe('select * from "main"."users" limit ? offset ?');
    expect(buildSelectTableSql("turso", "main", "users")).toBe('select * from "main"."users" limit ? offset ?');
    expect(buildSelectTableSql("cloudflare-d1", "main", "users")).toBe('select * from "main"."users" limit ? offset ?');
  });

  test("builds unfiltered count and select SQL", () => {
    expect(buildFilteredCountTableSql("postgresql", "public", "users", columns, undefined)).toEqual({
      sql: 'select count(*)::int as count from "public"."users"',
      params: []
    });
    expect(buildFilteredCountTableSql("mysql", "app", "users", columns, undefined)).toEqual({
      sql: "select count(*) as count from `app`.`users`",
      params: []
    });
    expect(buildFilteredCountTableSql("turso", "main", "users", columns, undefined)).toEqual({
      sql: 'select count(*) as count from "main"."users"',
      params: []
    });
    expect(buildFilteredSelectTableSql("postgresql", "public", "users", columns, undefined, 100, 200)).toEqual({
      sql: 'select * from "public"."users" limit $1 offset $2',
      params: [100, 200]
    });
  });

  test("builds one specific-column equality filter per dialect", () => {
    expect(
      buildFilteredCountTableSql("postgresql", "public", "users", columns, filter("name", "equals", "Ada"))
    ).toEqual({
      sql: 'select count(*)::int as count from "public"."users" where "name"::text = $1',
      params: ["Ada"]
    });
    expect(buildFilteredCountTableSql("mysql", "app", "users", columns, filter("name", "equals", "Ada"))).toEqual({
      sql: "select count(*) as count from `app`.`users` where cast(`name` as char) = ?",
      params: ["Ada"]
    });
    expect(buildFilteredCountTableSql("sqlite", "main", "users", columns, filter("name", "equals", "Ada"))).toEqual({
      sql: 'select count(*) as count from "main"."users" where cast("name" as text) = ?',
      params: ["Ada"]
    });
  });

  test("builds multiple AND rules", () => {
    expect(
      buildFilteredCountTableSql("postgresql", "public", "users", columns, {
        rules: [
          { id: "1", enabled: true, column: "name", operator: "contains", value: "Ada" },
          { id: "2", enabled: true, column: "id", operator: "greaterThan", value: "10" }
        ]
      })
    ).toEqual({
      sql: 'select count(*)::int as count from "public"."users" where "name"::text ilike $1 escape \'\\\' and "id" > $2',
      params: ["%Ada%", "10"]
    });
  });

  test("builds Any column contains with OR across columns", () => {
    expect(buildFilteredCountTableSql("postgresql", "public", "users", columns, anyFilter("contains", "ada"))).toEqual({
      sql: 'select count(*)::int as count from "public"."users" where ("id"::text ilike $1 escape \'\\\' or "name"::text ilike $2 escape \'\\\' or "email"::text ilike $3 escape \'\\\')',
      params: ["%ada%", "%ada%", "%ada%"]
    });
    expect(buildFilteredCountTableSql("mysql", "app", "users", columns, anyFilter("contains", "ada"))).toEqual({
      sql: "select count(*) as count from `app`.`users` where (lower(cast(`id` as char)) like lower(?) escape '\\' or lower(cast(`name` as char)) like lower(?) escape '\\' or lower(cast(`email` as char)) like lower(?) escape '\\')",
      params: ["%ada%", "%ada%", "%ada%"]
    });
  });

  test("builds Any column not contains with not around OR across columns", () => {
    expect(
      buildFilteredCountTableSql("postgresql", "public", "users", columns, anyFilter("notContains", "ada"))
    ).toEqual({
      sql: 'select count(*)::int as count from "public"."users" where not ("id"::text ilike $1 escape \'\\\' or "name"::text ilike $2 escape \'\\\' or "email"::text ilike $3 escape \'\\\')',
      params: ["%ada%", "%ada%", "%ada%"]
    });
  });

  test("escapes LIKE wildcard characters", () => {
    expect(
      buildFilteredCountTableSql("postgresql", "public", "users", columns, {
        rules: [{ id: "1", enabled: true, column: "name", operator: "contains", value: "50%_off\\now" }]
      }).params
    ).toEqual(["%50\\%\\_off\\\\now%"]);
  });

  test("builds IN with dialect-specific params", () => {
    expect(
      buildFilteredCountTableSql("postgresql", "public", "users", columns, filter("name", "in", "Ada, Grace, ,"))
    ).toEqual({
      sql: 'select count(*)::int as count from "public"."users" where "name"::text = any($1::text[])',
      params: [["Ada", "Grace"]]
    });
    expect(
      buildFilteredCountTableSql("sqlite", "main", "users", columns, filter("name", "in", "Ada, Grace, ,"))
    ).toEqual({
      sql: 'select count(*) as count from "main"."users" where cast("name" as text) in (?, ?)',
      params: ["Ada", "Grace"]
    });
    expect(
      buildFilteredCountTableSql("cloudflare-d1", "main", "users", columns, filter("name", "in", "Ada, Grace, ,"))
    ).toEqual({
      sql: 'select count(*) as count from "main"."users" where cast("name" as text) in (?, ?)',
      params: ["Ada", "Grace"]
    });
  });

  test("builds IS NULL without a value param", () => {
    expect(buildFilteredCountTableSql("postgresql", "public", "users", columns, filter("email", "isNull", ""))).toEqual(
      {
        sql: 'select count(*)::int as count from "public"."users" where "email" is null',
        params: []
      }
    );
  });

  test("rejects unknown filter columns and invalid operators", () => {
    expect(() =>
      buildFilteredCountTableSql("postgresql", "public", "users", columns, filter("missing", "equals", "Ada"))
    ).toThrow("Unknown filter column");
    expect(() =>
      buildFilteredCountTableSql("postgresql", "public", "users", columns, {
        rules: [{ id: "1", enabled: true, column: "name", operator: "bad" as never, value: "Ada" }]
      })
    ).toThrow("Invalid filter operator");
  });

  test("appends pagination params after filter params", () => {
    expect(
      buildFilteredSelectTableSql("postgresql", "public", "users", columns, filter("name", "equals", "Ada"), 50, 100)
    ).toEqual({
      sql: 'select * from "public"."users" where "name"::text = $1 limit $2 offset $3',
      params: ["Ada", 50, 100]
    });
    expect(
      buildFilteredSelectTableSql("mysql", "app", "users", columns, filter("name", "equals", "Ada"), 50, 100)
    ).toEqual({
      sql: "select * from `app`.`users` where cast(`name` as char) = ? limit ? offset ?",
      params: ["Ada", 50, 100]
    });
  });

  test("builds sorted table select SQL", () => {
    expect(
      buildFilteredSelectTableSql("postgresql", "public", "users", columns, undefined, 100, 0, {
        column: "name",
        direction: "asc"
      })
    ).toEqual({
      sql: 'select * from "public"."users" order by "name" asc limit $1 offset $2',
      params: [100, 0]
    });
    expect(
      buildFilteredSelectTableSql("mysql", "app", "users", columns, filter("email", "isNotNull", ""), 50, 100, {
        column: "id",
        direction: "desc"
      })
    ).toEqual({
      sql: "select * from `app`.`users` where `email` is not null order by `id` desc limit ? offset ?",
      params: [50, 100]
    });
  });

  test("formats generated statements with literal params for history", () => {
    expect(
      formatSqlStatementForHistory(
        {
          sql: 'select * from "public"."users" where "name"::text = $1 and "id" > $2 limit $3 offset $4',
          params: ["Ada's", 10, 50, 100]
        },
        "postgresql"
      )
    ).toBe('select * from "public"."users" where "name"::text = \'Ada\'\'s\' and "id" > 10 limit 50 offset 100');

    expect(
      formatSqlStatementForHistory(
        {
          sql: "insert into `app`.`users` (`name`, `active`) values (?, ?)",
          params: ["Grace", true]
        },
        "mysql"
      )
    ).toBe("insert into `app`.`users` (`name`, `active`) values ('Grace', true)");

    expect(
      formatSqlStatementForHistory(
        {
          sql: 'select * from "main"."users" where cast("name" as text) in (?, ?) limit ? offset ?',
          params: ["Ada", null, 25, 0]
        },
        "sqlite"
      )
    ).toBe('select * from "main"."users" where cast("name" as text) in (\'Ada\', null) limit 25 offset 0');
  });

  test("formats PostgreSQL array params for history", () => {
    expect(
      formatSqlStatementForHistory(
        {
          sql: 'select * from "public"."users" where "name"::text = any($1::text[]) limit $2 offset $3',
          params: [["Ada", "Grace"], 100, 0]
        },
        "postgresql"
      )
    ).toBe(
      'select * from "public"."users" where "name"::text = any(array[\'Ada\', \'Grace\']::text[]) limit 100 offset 0'
    );
  });

  test("rejects unknown sort columns and invalid directions", () => {
    expect(() => buildTableSortOrderSql("postgresql", { column: "missing", direction: "asc" }, columns)).toThrow(
      "Unknown sort column"
    );
    expect(() =>
      buildTableSortOrderSql("postgresql", { column: "name", direction: "sideways" as never }, columns)
    ).toThrow("Invalid sort direction");
  });

  test("builds parameterized insert SQL", () => {
    expect(buildInsertSql("postgresql", "public", "users", { name: "Ada", age: 37 })).toEqual({
      sql: 'insert into "public"."users" ("name", "age") values ($1, $2)',
      params: ["Ada", 37]
    });
    expect(buildInsertSql("mysql", "app", "users", { name: "Ada", age: 37 }).sql).toBe(
      "insert into `app`.`users` (`name`, `age`) values (?, ?)"
    );
  });

  test("builds parameterized update SQL with primary key predicate", () => {
    expect(buildUpdateSql("postgresql", "public", "users", { id: 1 }, { name: "Grace" }).sql).toBe(
      'update "public"."users" set "name" = $1 where "id" is not distinct from $2'
    );
    expect(buildUpdateSql("mysql", "app", "users", { id: 1 }, { name: "Grace" }).sql).toBe(
      "update `app`.`users` set `name` = ? where `id` <=> ?"
    );
    expect(buildUpdateSql("sqlite", "main", "users", { id: 1 }, { name: "Grace" }).sql).toBe(
      'update "main"."users" set "name" = ? where "id" is ?'
    );
    expect(buildUpdateSql("turso", "main", "users", { id: 1 }, { name: "Grace" }).sql).toBe(
      'update "main"."users" set "name" = ? where "id" is ?'
    );
  });

  test("builds parameterized delete SQL with primary key predicate", () => {
    expect(buildDeleteSql("postgresql", "public", "users", { id: 1 }).sql).toBe(
      'delete from "public"."users" where "id" is not distinct from $1'
    );
    expect(buildDeleteSql("mysql", "app", "users", { id: 1 }).sql).toBe("delete from `app`.`users` where `id` <=> ?");
    expect(buildDeleteSql("sqlite", "main", "users", { id: 1 }).sql).toBe('delete from "main"."users" where "id" is ?');
    expect(buildDeleteSql("cloudflare-d1", "main", "users", { id: 1 }).sql).toBe(
      'delete from "main"."users" where "id" is ?'
    );
  });
});

function filter(column: string, operator: TableFilterOperator, value: string) {
  return {
    rules: [{ id: "1", enabled: true, column, operator, value }]
  };
}

function anyFilter(operator: TableFilterOperator, value: string) {
  return {
    rules: [{ id: "1", enabled: true, column: null, operator, value }]
  };
}

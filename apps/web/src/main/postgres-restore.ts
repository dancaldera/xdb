import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { Writable } from "node:stream";
import type pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { parseSqlScript } from "./sql-script";

export type PostgresRestoreProgress = {
  phase: "executing" | "copying-data";
  statementsDone?: number;
  table?: string;
};

export type PostgresRestoreOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: PostgresRestoreProgress) => void;
};

const PROGRESS_STATEMENT_INTERVAL = 25;

export async function isCustomFormatDump(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.alloc(5);
    const { bytesRead } = await handle.read(buffer, 0, 5, 0);
    return bytesRead === 5 && buffer.toString("latin1") === "PGDMP";
  } finally {
    await handle.close();
  }
}

export async function restoreSqlFile(
  client: pg.ClientBase,
  filePath: string,
  options: PostgresRestoreOptions = {}
): Promise<void> {
  const { signal, onProgress } = options;
  const input = createReadStream(filePath, { encoding: "utf8" });
  let statementsDone = 0;
  let copySink: Writable | null = null;

  try {
    for await (const event of parseSqlScript(input)) {
      if (signal?.aborted) {
        throw new Error("Restore cancelled.");
      }

      switch (event.kind) {
        case "statement": {
          await client.query(event.sql);
          statementsDone += 1;
          if (statementsDone % PROGRESS_STATEMENT_INTERVAL === 0) {
            onProgress?.({ phase: "executing", statementsDone });
          }
          break;
        }
        case "copy-start": {
          copySink = client.query(copyFrom(event.sql));
          onProgress?.({
            phase: "copying-data",
            table: extractCopyTableName(event.sql) ?? undefined,
            statementsDone
          });
          break;
        }
        case "copy-chunk": {
          if (copySink) {
            await writeChunk(copySink, event.chunk);
          }
          break;
        }
        case "copy-end": {
          if (copySink) {
            await finishCopy(copySink);
            copySink = null;
            statementsDone += 1;
          }
          break;
        }
      }
    }
  } catch (error) {
    if (copySink) {
      copySink.on("error", () => {});
      copySink.destroy();
    }
    input.destroy();
    // After an aborted COPY the connection may still be in copy-in mode and a
    // ROLLBACK would queue forever; the caller destroys the connection, which
    // rolls back any open transaction server-side.
    if (!signal?.aborted) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw signal?.aborted ? new Error("Restore cancelled.") : error;
  }
}

export function extractCopyTableName(sql: string): string | null {
  const match = sql.match(/^\s*copy\s+((?:"[^"]*"|[A-Za-z0-9_$.])+)/i);
  return match ? match[1].replaceAll('"', "") : null;
}

function writeChunk(sink: Writable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sink.write(chunk, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function finishCopy(sink: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    sink.once("error", reject);
    sink.once("finish", resolve);
    sink.end();
  });
}

import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { DatabaseService } from "../main/database";
import { AppStore } from "../main/store";
import { StorageService } from "../main/storage";
import { createApiHandlers } from "./api";

const PORT = Number(process.env.XDB_PORT ?? 4595);
const HOST = process.env.XDB_HOST ?? "127.0.0.1";
const DATA_DIR = process.env.XDB_DATA_DIR ?? join(homedir(), ".xdb");
const STATIC_DIR = resolve(import.meta.dirname, "../../dist/web");
const APP_VERSION = JSON.parse(await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8"))
  .version as string;

const store = new AppStore(DATA_DIR);
const database = new DatabaseService(store);
const storage = new StorageService(store);
const api = createApiHandlers({ store, database, storage });

const eventClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function broadcast(channel: "database:backup-progress" | "database:restore-progress", payload: unknown): void {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify({ channel, payload })}\n\n`);
  for (const client of eventClients) {
    try {
      client.enqueue(encoded);
    } catch {
      eventClients.delete(client);
    }
  }
}

api.setProgressEmitter(broadcast);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function serveStatic(pathname: string): Response | undefined {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolvedRoot = resolve(STATIC_DIR);
  let filePath = resolve(resolvedRoot, relativePath);

  if (!filePath.startsWith(resolvedRoot)) {
    return undefined;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback.
    filePath = join(resolvedRoot, "index.html");
    if (!existsSync(filePath)) {
      return undefined;
    }
  }

  const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: { "content-type": mime }
  });
}

async function handleUpload(request: Request): Promise<Response> {
  const form = await request.formData();
  const entries = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (entries.length === 0) {
    return Response.json({ ok: false, error: "No files were uploaded." }, { status: 400 });
  }

  const rawRelativePaths = String(form.get("relativePaths") ?? "[]");
  let relativePaths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(rawRelativePaths);
    if (Array.isArray(parsed)) {
      relativePaths = parsed.map((item) => String(item));
    }
  } catch {
    relativePaths = [];
  }

  const uploadId = crypto.randomUUID();
  const uploadRoot = normalize(join(DATA_DIR, "uploads", uploadId));
  await mkdir(uploadRoot, { recursive: true });

  const savedPaths: string[] = [];
  for (const [index, file] of entries.entries()) {
    const safeName = (file.name || `file-${index}`).replace(/[/\\]/g, "_");
    const relativePath = relativePaths[index];
    const targetDir = relativePath ? normalize(join(uploadRoot, relativePath, "..")) : uploadRoot;

    if (!targetDir.startsWith(normalize(uploadRoot))) {
      continue;
    }

    await mkdir(targetDir, { recursive: true });
    const targetPath = relativePath
      ? normalize(join(targetDir, relativePath.split("/").pop() ?? safeName))
      : join(uploadRoot, safeName);
    await writeFile(targetPath, Buffer.from(await file.arrayBuffer()));
    savedPaths.push(targetPath);
  }

  return Response.json({ ok: true, data: { paths: savedPaths, root: uploadRoot } });
}

async function handleIpc(channel: string, request: Request): Promise<Response> {
  let args: unknown[] = [];
  try {
    const body = (await request.json()) as { args?: unknown[] };
    if (Array.isArray(body.args)) {
      args = body.args;
    }
  } catch {
    // Empty or invalid body: treat as no arguments.
  }

  try {
    const data = await api.invoke(channel, args);
    return Response.json({ ok: true, data: data ?? null });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/events") {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        eventClients.add(controller);
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel(controller) {
        eventClients.delete(controller);
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    });
  }

  if (pathname === "/api/uploads" && request.method === "POST") {
    return handleUpload(request);
  }

  if (pathname.startsWith("/api/ipc/")) {
    const channel = pathname.slice("/api/ipc/".length);
    if (!api.hasHandler(channel)) {
      return Response.json({ ok: false, error: `Unknown command: ${channel}` }, { status: 404 });
    }

    return handleIpc(channel, request);
  }

  if (pathname === "/api/health") {
    return Response.json({ ok: true, data: { version: APP_VERSION } });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const staticResponse = serveStatic(pathname);
  if (staticResponse) {
    return staticResponse;
  }

  return new Response("Not found", { status: 404 });
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? `${HOST}:${PORT}`;
  const body = await readBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers,
    body,
    // Node's undici Request requires this flag when a stream body is used; buffers are fine either way.
    duplex: body ? "half" : undefined
  } as RequestInit);
}

async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

const server = createServer((req, res) => {
  void toWebRequest(req)
    .then(handle)
    .then((response) => sendResponse(response, res))
    .catch((error) => {
      res.statusCode = 500;
      res.end(String(error instanceof Error ? error.message : error));
    });
});

server.listen(PORT, HOST, () => {
  console.log(`XDB web server running at http://${HOST}:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

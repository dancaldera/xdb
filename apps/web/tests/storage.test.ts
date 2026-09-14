import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  classifyPreview,
  formatStorageBytes,
  joinStorageKey,
  normalizeStoragePrefix,
  StorageService,
  storageBasename
} from "../src/main/storage";
import type { AppStore } from "../src/main/store";
import type { ConnectionProfile } from "../src/shared/types";

const profile: ConnectionProfile & { password: string } = {
  id: "s3-profile",
  kind: "storage",
  engine: "s3-compatible",
  name: "Assets",
  host: "",
  port: 0,
  database: "",
  endpoint: "https://s3.example.com",
  bucket: "assets",
  region: "auto",
  accessKeyId: "access-key",
  password: "secret-key",
  rootPrefix: "root/",
  forcePathStyle: true,
  user: "",
  sslMode: "require",
  color: "#242d64",
  savePassword: true,
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

class FakeStore {
  constructor(private readonly connection: ConnectionProfile & { password: string }) {}

  async getConnection(profileId: string): Promise<(ConnectionProfile & { password?: string }) | null> {
    return profileId === this.connection.id ? this.connection : null;
  }
}

class FakeS3Client {
  commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  responses = new Map<string, unknown>();

  async send(command: { input: Record<string, unknown>; constructor: { name: string } }): Promise<unknown> {
    this.commands.push({ name: command.constructor.name, input: command.input });
    const key = `${command.constructor.name}:${String(command.input.Key ?? "")}`;
    const response = this.responses.get(key) ?? this.responses.get(command.constructor.name) ?? {};
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  destroy(): void {}
}

describe("storage helpers", () => {
  test("normalizes storage paths and preview classifications", () => {
    expect(joinStorageKey("root/", "/photos/", "cat.png")).toBe("root/photos/cat.png");
    expect(joinStorageKey("photos", "cats/")).toBe("photos/cats/");
    expect(normalizeStoragePrefix("/photos/cats")).toBe("photos/cats/");
    expect(storageBasename("photos/cats/cat.png")).toBe("cat.png");
    expect(classifyPreview("cat.png", null)).toBe("image");
    expect(classifyPreview("data.json", "application/json")).toBe("text");
    expect(classifyPreview("archive.zip", "application/zip")).toBe("unsupported");
    expect(formatStorageBytes(1536)).toBe("1.50 KB");
  });
});

describe("StorageService", () => {
  test("connects by sending HeadBucketCommand", async () => {
    const client = new FakeS3Client();
    const service = new StorageService(new FakeStore(profile) as unknown as AppStore, () => client as never);

    const status = await service.connect(profile.id);

    expect(client.commands[0]).toEqual({ name: "HeadBucketCommand", input: { Bucket: "assets" } });
    expect(status).toEqual({
      profileId: profile.id,
      engine: "s3-compatible",
      connected: true,
      bucket: "assets",
      region: "auto",
      endpoint: "https://s3.example.com",
      rootPrefix: "root/"
    });
  });

  test("lists folders and files with root prefix and pagination", async () => {
    const client = new FakeS3Client();
    client.responses.set("ListObjectsV2Command", {
      CommonPrefixes: [{ Prefix: "root/photos/" }],
      Contents: [
        { Key: "root/current/", Size: 0 },
        { Key: "root/current/cat.png", Size: 24, LastModified: new Date("2026-01-01T00:00:00.000Z"), ETag: "abc" }
      ],
      IsTruncated: true,
      NextContinuationToken: "next"
    });
    const service = new StorageService(new FakeStore(profile) as unknown as AppStore, () => client as never);
    await service.connect(profile.id);

    const result = await service.listObjects({
      profileId: profile.id,
      prefix: "current/",
      continuationToken: "token",
      pageSize: 50
    });

    expect(client.commands.at(-1)?.input).toMatchObject({
      Bucket: "assets",
      Prefix: "root/current/",
      Delimiter: "/",
      ContinuationToken: "token",
      MaxKeys: 50
    });
    expect(result.nextContinuationToken).toBe("next");
    expect(result.objects).toEqual([
      {
        type: "folder",
        key: "photos/",
        prefix: "photos/",
        name: "photos",
        size: null,
        etag: null,
        lastModified: null
      },
      {
        type: "file",
        key: "current/cat.png",
        prefix: "current/",
        name: "cat.png",
        size: 24,
        etag: "abc",
        lastModified: "2026-01-01T00:00:00.000Z"
      }
    ]);
  });

  test("previews image and text objects", async () => {
    const client = new FakeS3Client();
    client.responses.set("HeadObjectCommand:root/cat.png", {
      ContentLength: 3,
      ContentType: "image/png",
      ETag: "abc",
      LastModified: new Date("2026-01-01T00:00:00.000Z"),
      Metadata: {}
    });
    client.responses.set("GetObjectCommand:root/cat.png", {
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) }
    });
    client.responses.set("HeadObjectCommand:root/readme.txt", {
      ContentLength: 5,
      ContentType: "text/plain",
      Metadata: {}
    });
    client.responses.set("GetObjectCommand:root/readme.txt", {
      Body: { transformToByteArray: async () => new TextEncoder().encode("hello") }
    });
    const service = new StorageService(new FakeStore(profile) as unknown as AppStore, () => client as never);
    await service.connect(profile.id);

    const image = await service.previewObject(profile.id, "cat.png");
    const text = await service.previewObject(profile.id, "readme.txt");

    expect(image).toMatchObject({ kind: "image", dataUrl: "data:image/png;base64,AQID" });
    expect(text).toMatchObject({ kind: "text", text: "hello", truncated: false });
  });

  test("downloads, creates folders, copies, moves, and deletes objects", async () => {
    const client = new FakeS3Client();
    client.responses.set("GetObjectCommand:root/cat.png", { Body: Readable.from(["hello"]) });
    client.responses.set(
      "HeadObjectCommand:root/copy.png",
      Object.assign(new Error("not found"), { name: "NotFound" })
    );
    const service = new StorageService(new FakeStore(profile) as unknown as AppStore, () => client as never);
    await service.connect(profile.id);
    const tempDir = await mkdtemp(join(tmpdir(), "pixql-storage-"));
    const filePath = join(tempDir, "cat.png");

    try {
      await service.downloadObject(profile.id, "cat.png", filePath);
      await service.createFolder(profile.id, "photos/", "cats");
      await service.copyObject({ profileId: profile.id, sourceKey: "cat.png", destinationKey: "copy.png" });
      await service.moveObject({
        profileId: profile.id,
        sourceKey: "cat.png",
        destinationKey: "moved.png",
        overwrite: true
      });
      await service.deleteObjects({ profileId: profile.id, keys: ["one.png", "two.png"] });

      expect(await readFile(filePath, "utf8")).toBe("hello");
      expect(client.commands.map((command) => command.name)).toContain("PutObjectCommand");
      expect(client.commands.map((command) => command.name)).toContain("CopyObjectCommand");
      expect(client.commands.map((command) => command.name)).toContain("DeleteObjectCommand");
      expect(client.commands.map((command) => command.name)).toContain("DeleteObjectsCommand");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

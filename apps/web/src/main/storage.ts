import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
  type CommonPrefix,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  ConnectionProfile,
  StorageCopyInput,
  StorageDeleteInput,
  StorageListInput,
  StorageListResult,
  StorageMoveInput,
  StorageObject,
  StorageObjectMetadata,
  StoragePreviewResult,
  StorageStatus,
  StorageTransferResult
} from "../shared/types";
import type { AppStore } from "./store";

const DEFAULT_PAGE_SIZE = 100;
const IMAGE_PREVIEW_LIMIT = 15 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".log",
  ".sql",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html"
]);

type S3ClientLike = Pick<S3Client, "send" | "destroy">;
type S3ClientFactory = (profile: ConnectionProfile & { password: string }) => S3ClientLike;

type StorageEntry = {
  client: S3ClientLike;
  profile: ConnectionProfile & { password: string };
};

export class StorageService {
  private readonly connections = new Map<string, StorageEntry>();

  constructor(
    private readonly store: AppStore,
    private readonly createClient: S3ClientFactory = createS3Client
  ) {}

  async connect(profileId: string, password?: string): Promise<StorageStatus> {
    const profile = await this.getProfileWithSecret(profileId, password);
    await this.disconnect(profileId);
    const client = this.createClient(profile);

    try {
      await client.send(new HeadBucketCommand({ Bucket: requiredBucket(profile) }));
      this.connections.set(profileId, { client, profile });
      return createStorageStatus(profile);
    } catch (error) {
      client.destroy?.();
      throw createStorageConnectionError(error, profile);
    }
  }

  async disconnect(profileId: string): Promise<void> {
    const entry = this.connections.get(profileId);
    if (!entry) {
      return;
    }

    entry.client.destroy?.();
    this.connections.delete(profileId);
  }

  async closeAll(): Promise<void> {
    for (const entry of this.connections.values()) {
      entry.client.destroy?.();
    }
    this.connections.clear();
  }

  async listObjects(input: StorageListInput): Promise<StorageListResult> {
    const { client, profile } = this.getEntry(input.profileId);
    const rootPrefix = profile.rootPrefix ?? "";
    const relativePrefix = normalizeStoragePrefix(input.prefix);
    const absolutePrefix = joinStorageKey(rootPrefix, relativePrefix);
    const pageSize = Math.min(1000, Math.max(10, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: requiredBucket(profile),
        Prefix: absolutePrefix,
        Delimiter: "/",
        ContinuationToken: input.continuationToken || undefined,
        MaxKeys: pageSize
      })
    );

    return {
      bucket: requiredBucket(profile),
      prefix: relativePrefix,
      objects: [
        ...(result.CommonPrefixes ?? []).map((prefix) => commonPrefixToStorageObject(prefix, rootPrefix)),
        ...(result.Contents ?? [])
          .filter((object) => object.Key && object.Key !== absolutePrefix)
          .map((object) => s3ObjectToStorageObject(object, rootPrefix))
      ].sort(compareStorageObjects),
      nextContinuationToken: result.NextContinuationToken ?? null,
      isTruncated: Boolean(result.IsTruncated)
    };
  }

  async getObjectMetadata(profileId: string, key: string): Promise<StorageObjectMetadata> {
    const { client, profile } = this.getEntry(profileId);
    const absoluteKey = absoluteStorageKey(profile, key);
    const result = await client.send(new HeadObjectCommand({ Bucket: requiredBucket(profile), Key: absoluteKey }));
    return {
      key,
      size: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
      lastModified: result.LastModified?.toISOString() ?? null,
      metadata: result.Metadata ?? {}
    };
  }

  async previewObject(profileId: string, key: string): Promise<StoragePreviewResult> {
    const metadata = await this.getObjectMetadata(profileId, key);
    const kind = classifyPreview(key, metadata.contentType);
    const size = metadata.size ?? 0;

    if (kind === "image" && size > IMAGE_PREVIEW_LIMIT) {
      return unsupportedPreview(key, metadata, "Image is too large to preview.");
    }

    if (kind === "text" && size > TEXT_PREVIEW_LIMIT) {
      const text = await this.readObjectBytes(profileId, key, TEXT_PREVIEW_LIMIT);
      return {
        kind: "text",
        key,
        contentType: metadata.contentType ?? "text/plain",
        text: text.toString("utf8"),
        truncated: true,
        size: metadata.size
      };
    }

    if (kind === "unsupported") {
      return unsupportedPreview(key, metadata, "This file type is not supported for preview.");
    }

    const bytes = await this.readObjectBytes(profileId, key);
    if (kind === "image") {
      const contentType = metadata.contentType || imageContentTypeFromKey(key);
      return {
        kind: "image",
        key,
        contentType,
        dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
        size: metadata.size
      };
    }

    return {
      kind: "text",
      key,
      contentType: metadata.contentType ?? "text/plain",
      text: bytes.toString("utf8"),
      truncated: false,
      size: metadata.size
    };
  }

  async downloadObject(profileId: string, key: string, filePath: string): Promise<{ filePath: string }> {
    const { client, profile } = this.getEntry(profileId);
    const result = await client.send(
      new GetObjectCommand({ Bucket: requiredBucket(profile), Key: absoluteStorageKey(profile, key) })
    );

    if (!result.Body) {
      throw new Error("S3 object response did not include a body.");
    }

    await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(filePath));
    return { filePath };
  }

  async uploadFiles(profileId: string, prefix: string, filePaths: string[]): Promise<StorageTransferResult> {
    const { client, profile } = this.getEntry(profileId);
    let uploaded = 0;

    for (const filePath of filePaths) {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        continue;
      }

      await this.uploadFile(client, profile, joinStorageKey(prefix, basename(filePath)), filePath);
      uploaded += 1;
    }

    return { uploaded, skipped: filePaths.length - uploaded };
  }

  async uploadFolder(profileId: string, prefix: string, folderPath: string): Promise<StorageTransferResult> {
    const { client, profile } = this.getEntry(profileId);
    const files = await listLocalFiles(folderPath);
    let uploaded = 0;

    for (const filePath of files) {
      const relativePath = relative(folderPath, filePath).split(sep).join("/");
      await this.uploadFile(client, profile, joinStorageKey(prefix, relativePath), filePath);
      uploaded += 1;
    }

    return { uploaded, skipped: 0 };
  }

  async createFolder(profileId: string, prefix: string, name: string): Promise<void> {
    const { client, profile } = this.getEntry(profileId);
    const folderName = normalizeFolderName(name);
    const key = absoluteStorageKey(profile, joinStorageKey(prefix, `${folderName}/`));
    await client.send(new PutObjectCommand({ Bucket: requiredBucket(profile), Key: key, Body: "" }));
  }

  async copyObject(input: StorageCopyInput): Promise<void> {
    const { client, profile } = this.getEntry(input.profileId);
    const sourceKey = absoluteStorageKey(profile, input.sourceKey);
    const destinationKey = absoluteStorageKey(profile, input.destinationKey);

    if (!input.overwrite) {
      await assertObjectDoesNotExist(client, profile, destinationKey);
    }

    await client.send(
      new CopyObjectCommand({
        Bucket: requiredBucket(profile),
        CopySource: `/${requiredBucket(profile)}/${encodeS3CopySourceKey(sourceKey)}`,
        Key: destinationKey
      })
    );
  }

  async moveObject(input: StorageMoveInput): Promise<void> {
    if (input.destinationKey.endsWith("/")) {
      throw new Error("Move destination must be a file key.");
    }

    await this.copyObject(input);
    await this.deleteObjects({ profileId: input.profileId, keys: [input.sourceKey] });
  }

  async deleteObjects(input: StorageDeleteInput): Promise<void> {
    const { client, profile } = this.getEntry(input.profileId);
    const keys = input.keys.map((key) => absoluteStorageKey(profile, key));
    if (keys.length === 0) {
      return;
    }

    if (keys.length === 1) {
      await client.send(new DeleteObjectCommand({ Bucket: requiredBucket(profile), Key: keys[0] }));
      return;
    }

    await client.send(
      new DeleteObjectsCommand({
        Bucket: requiredBucket(profile),
        Delete: {
          Objects: keys.map((key) => ({ Key: key }))
        }
      })
    );
  }

  private async uploadFile(
    client: S3ClientLike,
    profile: ConnectionProfile & { password: string },
    relativeKey: string,
    filePath: string
  ): Promise<void> {
    const upload = new Upload({
      client: client as S3Client,
      params: {
        Bucket: requiredBucket(profile),
        Key: absoluteStorageKey(profile, relativeKey),
        Body: createReadStream(filePath)
      }
    });
    await upload.done();
  }

  private async readObjectBytes(profileId: string, key: string, maxBytes?: number): Promise<Buffer> {
    const { client, profile } = this.getEntry(profileId);
    const result = await client.send(
      new GetObjectCommand({
        Bucket: requiredBucket(profile),
        Key: absoluteStorageKey(profile, key),
        Range: maxBytes ? `bytes=0-${Math.max(0, maxBytes - 1)}` : undefined
      })
    );

    if (!result.Body) {
      throw new Error("S3 object response did not include a body.");
    }

    return streamToBuffer(result.Body);
  }

  private async getProfileWithSecret(
    profileId: string,
    password?: string
  ): Promise<ConnectionProfile & { password: string }> {
    const profile = await this.store.getConnection(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }
    if (profile.engine !== "s3-compatible") {
      throw new Error("Connection profile is not an S3-compatible connection.");
    }
    if (!profile.endpoint) {
      throw new Error("S3-compatible endpoint URL is required.");
    }
    if (!profile.accessKeyId) {
      throw new Error("S3-compatible access key ID is required.");
    }
    if (!profile.bucket) {
      throw new Error("S3-compatible bucket is required.");
    }

    const resolvedPassword = password ?? profile.password ?? "";
    if (!resolvedPassword) {
      throw new Error("This S3-compatible connection requires a secret access key.");
    }

    return { ...profile, password: resolvedPassword };
  }

  private getEntry(profileId: string): StorageEntry {
    const entry = this.connections.get(profileId);
    if (!entry) {
      throw new Error("Not connected. Open the connection first.");
    }

    return entry;
  }
}

function createS3Client(profile: ConnectionProfile & { password: string }): S3Client {
  const config: S3ClientConfig = {
    endpoint: profile.endpoint,
    region: profile.region || "us-east-1",
    forcePathStyle: profile.forcePathStyle ?? true,
    credentials: {
      accessKeyId: profile.accessKeyId ?? "",
      secretAccessKey: profile.password,
      sessionToken: profile.sessionToken || undefined
    }
  };
  return new S3Client(config);
}

function createStorageStatus(profile: ConnectionProfile & { password: string }): StorageStatus {
  return {
    profileId: profile.id,
    engine: "s3-compatible",
    connected: true,
    bucket: requiredBucket(profile),
    region: profile.region || "us-east-1",
    endpoint: profile.endpoint ?? "",
    rootPrefix: profile.rootPrefix ?? ""
  };
}

function createStorageConnectionError(error: unknown, profile: ConnectionProfile): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/access denied|forbidden|invalidaccesskeyid|signature/i.test(message)) {
    return new Error("S3-compatible storage rejected the credentials. Check the access key and secret key.");
  }

  return error instanceof Error ? error : new Error(String(error || `Unable to connect to ${profile.bucket}.`));
}

export function joinStorageKey(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .join("/")
    .replace(/\/?$/, (parts.at(-1) ?? "").endsWith("/") ? "/" : "");
}

export function normalizeStoragePrefix(prefix: string | undefined): string {
  const normalized = (prefix ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `${normalized}/` : "";
}

export function storageBasename(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "/";
}

export function classifyPreview(key: string, contentType: string | null | undefined): "image" | "text" | "unsupported" {
  const normalizedType = contentType?.toLowerCase() ?? "";
  const extension = extensionForKey(key);

  if (normalizedType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (
    normalizedType.startsWith("text/") ||
    ["json", "xml", "csv", "yaml", "toml", "javascript", "typescript"].some((part) => normalizedType.includes(part)) ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }

  return "unsupported";
}

export function formatStorageBytes(value: number | null): string {
  if (value === null) {
    return "";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`;
}

function absoluteStorageKey(profile: ConnectionProfile, key: string): string {
  return joinStorageKey(profile.rootPrefix, key);
}

function requiredBucket(profile: ConnectionProfile): string {
  if (!profile.bucket) {
    throw new Error("S3-compatible bucket is required.");
  }

  return profile.bucket;
}

function commonPrefixToStorageObject(prefix: CommonPrefix, rootPrefix: string): StorageObject {
  const key = stripRootPrefix(prefix.Prefix ?? "", rootPrefix);
  return {
    type: "folder",
    key,
    prefix: key,
    name: storageBasename(key),
    size: null,
    etag: null,
    lastModified: null
  };
}

function s3ObjectToStorageObject(object: _Object, rootPrefix: string): StorageObject {
  const key = stripRootPrefix(object.Key ?? "", rootPrefix);
  return {
    type: "file",
    key,
    prefix: parentPrefix(key),
    name: storageBasename(key),
    size: object.Size ?? null,
    etag: object.ETag ?? null,
    lastModified: object.LastModified?.toISOString() ?? null
  };
}

function stripRootPrefix(key: string, rootPrefix: string): string {
  return rootPrefix && key.startsWith(rootPrefix) ? key.slice(rootPrefix.length) : key;
}

function parentPrefix(key: string): string {
  const parts = key.split("/");
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}

function compareStorageObjects(left: StorageObject, right: StorageObject): number {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function unsupportedPreview(
  key: string,
  metadata: StorageObjectMetadata,
  reason: string
): Extract<StoragePreviewResult, { kind: "unsupported" }> {
  return {
    kind: "unsupported",
    key,
    contentType: metadata.contentType,
    size: metadata.size,
    reason
  };
}

function imageContentTypeFromKey(key: string): string {
  const extension = extensionForKey(key);
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".jpg") {
    return "image/jpeg";
  }
  return `image/${extension.replace(/^\./, "") || "png"}`;
}

function extensionForKey(key: string): string {
  const name = storageBasename(key).toLowerCase();
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? "" : name.slice(dotIndex);
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body && typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function listLocalFiles(folderPath: string): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(folderPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listLocalFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function normalizeFolderName(name: string): string {
  const normalized = name.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("/")) {
    throw new Error("Folder name must be a single non-empty path segment.");
  }

  return normalized;
}

function encodeS3CopySourceKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function assertObjectDoesNotExist(
  client: S3ClientLike,
  profile: ConnectionProfile & { password: string },
  key: string
): Promise<void> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: requiredBucket(profile), Key: key }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NotFound" || statusCode === 404) {
      return;
    }

    throw error;
  }

  throw new Error("Destination object already exists.");
}

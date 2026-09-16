import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type _Object,
  type CommonPrefix,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { formatStorageBytes } from "../shared/format";
import type {
  ConnectionProfile,
  StorageBucket,
  StorageCopyInput,
  StorageDeleteInput,
  StorageListInput,
  StorageListResult,
  StorageMoveInput,
  StorageObject,
  StorageObjectMetadata,
  StoragePreviewResult,
  StorageStatus,
  StorageTransferProgress,
  StorageTransferResult
} from "../shared/types";
import type { AppStore } from "./store";

const DEFAULT_PAGE_SIZE = 100;
const MAX_DELETE_BATCH = 1000;
const FILTER_SCAN_LIMIT = 10_000;
const UPLOAD_CONCURRENCY = 6;
const PREVIEW_URL_TTL_SECONDS = 3600;
const TEXT_PREVIEW_LIMIT = 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"]);
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

export type StoragePreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "unsupported";

type StorageEntry = {
  client: S3Client;
  profile: ConnectionProfile & { password: string };
};

type S3ClientFactory = (profile: ConnectionProfile & { password: string }) => S3Client;
type PreviewUrlSigner = (entry: StorageEntry, key: string, contentType: string | null) => Promise<string>;
type TransferProgressReporter = (progress: Omit<StorageTransferProgress, "taskId">) => void;

export type StorageObjectStream = {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
  fileName: string;
};

export class StorageService {
  private readonly connections = new Map<string, StorageEntry>();

  constructor(
    private readonly store: AppStore,
    private readonly createClient: S3ClientFactory = createS3Client,
    private readonly signPreviewUrl: PreviewUrlSigner = defaultPreviewUrlSigner
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

  async listBuckets(profileId: string): Promise<StorageBucket[]> {
    const { client } = this.getEntry(profileId);
    const result = await client.send(new ListBucketsCommand({}));
    return (result.Buckets ?? [])
      .map((bucket) => ({
        name: bucket.Name ?? "",
        creationDate: bucket.CreationDate?.toISOString() ?? null
      }))
      .filter((bucket) => bucket.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async selectBucket(profileId: string, bucket: string): Promise<StorageStatus> {
    const entry = this.getEntry(profileId);
    const name = bucket.trim();
    if (!name) {
      throw new Error("Bucket name is required.");
    }

    await entry.client.send(new HeadBucketCommand({ Bucket: name }));
    entry.profile = { ...entry.profile, bucket: name, rootPrefix: "" };
    return createStorageStatus(entry.profile);
  }

  async listObjects(input: StorageListInput): Promise<StorageListResult> {
    const { client, profile } = this.getEntry(input.profileId);
    const rootPrefix = profile.rootPrefix ?? "";
    const relativePrefix = normalizeStoragePrefix(input.prefix);
    const absolutePrefix = joinStorageKey(rootPrefix, relativePrefix);
    const pageSize = Math.min(1000, Math.max(10, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const filter = input.filter?.trim().toLowerCase() ?? "";

    if (filter) {
      return this.searchObjects(client, profile, absolutePrefix, relativePrefix, filter, pageSize);
    }

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

  private async searchObjects(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    absolutePrefix: string,
    relativePrefix: string,
    filter: string,
    pageSize: number
  ): Promise<StorageListResult> {
    const rootPrefix = profile.rootPrefix ?? "";
    const objects: StorageObject[] = [];
    let continuationToken: string | undefined;
    let scanned = 0;
    let truncated = false;

    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: requiredBucket(profile),
          Prefix: absolutePrefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000
        })
      );

      for (const object of result.Contents ?? []) {
        scanned += 1;
        if (!object.Key || object.Key === absolutePrefix) {
          continue;
        }

        const relativeKey = stripRootPrefix(object.Key, rootPrefix);
        if (!relativeKey.toLowerCase().includes(filter)) {
          continue;
        }

        objects.push(s3ObjectToStorageObject(object, rootPrefix));
        if (objects.length >= pageSize) {
          truncated = true;
          break;
        }
      }

      continuationToken = result.NextContinuationToken ?? undefined;
      if (truncated || scanned >= FILTER_SCAN_LIMIT) {
        truncated = true;
        break;
      }
    } while (continuationToken);

    objects.sort(compareStorageObjects);
    return {
      bucket: requiredBucket(profile),
      prefix: relativePrefix,
      objects,
      nextContinuationToken: null,
      isTruncated: truncated
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
    const entry = this.getEntry(profileId);
    const metadata = await this.getObjectMetadata(profileId, key);
    const kind = classifyPreview(key, metadata.contentType);

    if (kind === "unsupported") {
      return unsupportedPreview(key, metadata, "This file type is not supported for preview.");
    }

    if (kind === "text") {
      const truncated = (metadata.size ?? 0) > TEXT_PREVIEW_LIMIT;
      const bytes = await this.readObjectBytes(profileId, key, truncated ? TEXT_PREVIEW_LIMIT : undefined);
      return {
        kind: "text",
        key,
        contentType: metadata.contentType ?? "text/plain",
        text: bytes.toString("utf8"),
        truncated,
        size: metadata.size
      };
    }

    const url = await this.signPreviewUrl(entry, absoluteStorageKey(entry.profile, key), metadata.contentType);
    return {
      kind,
      key,
      contentType: metadata.contentType ?? defaultContentTypeForKind(kind, key),
      url,
      size: metadata.size
    };
  }

  async openObjectStream(profileId: string, key: string): Promise<StorageObjectStream> {
    const { client, profile } = this.getEntry(profileId);
    const result = await client.send(
      new GetObjectCommand({ Bucket: requiredBucket(profile), Key: absoluteStorageKey(profile, key) })
    );

    if (!result.Body) {
      throw new Error("S3 object response did not include a body.");
    }

    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? null,
      contentLength: result.ContentLength ?? null,
      fileName: storageBasename(key)
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

  async uploadFiles(
    profileId: string,
    prefix: string,
    filePaths: string[],
    options: { taskId?: string; onProgress?: TransferProgressReporter } = {}
  ): Promise<StorageTransferResult> {
    const { client, profile } = this.getEntry(profileId);
    const candidates: Array<{ filePath: string; key: string }> = [];
    let skipped = 0;

    for (const filePath of filePaths) {
      const fileStats = await stat(filePath).catch(() => null);
      if (!fileStats?.isFile()) {
        skipped += 1;
        continue;
      }
      candidates.push({ filePath, key: joinStorageKey(prefix, basename(filePath)) });
    }

    const result = await this.uploadEntries(client, profile, candidates, options);
    return { uploaded: result.uploaded, skipped, failed: result.failed };
  }

  async uploadFolder(
    profileId: string,
    prefix: string,
    folderPath: string,
    options: { taskId?: string; onProgress?: TransferProgressReporter } = {}
  ): Promise<StorageTransferResult> {
    const { client, profile } = this.getEntry(profileId);
    const files = await listLocalFiles(folderPath);
    const candidates = files.map((filePath) => ({
      filePath,
      key: joinStorageKey(prefix, relative(folderPath, filePath).split(sep).join("/"))
    }));

    const result = await this.uploadEntries(client, profile, candidates, options);
    return { uploaded: result.uploaded, skipped: 0, failed: result.failed };
  }

  private async uploadEntries(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    candidates: Array<{ filePath: string; key: string }>,
    options: { taskId?: string; onProgress?: TransferProgressReporter }
  ): Promise<{ uploaded: number; failed: number }> {
    const total = candidates.length;
    let uploaded = 0;
    let failed = 0;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < total) {
        const candidate = candidates[nextIndex];
        nextIndex += 1;
        options.onProgress?.({ phase: "uploading", done: uploaded + failed, total, current: candidate.key });
        try {
          const upload = new Upload({
            client,
            params: {
              Bucket: requiredBucket(profile),
              Key: absoluteStorageKey(profile, candidate.key),
              Body: createReadStream(candidate.filePath)
            }
          });
          await upload.done();
          uploaded += 1;
        } catch {
          failed += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, () => worker()));
    options.onProgress?.({ phase: failed === total && total > 0 ? "failed" : "done", done: total, total });
    return { uploaded, failed };
  }

  async createFolder(profileId: string, prefix: string, name: string): Promise<void> {
    const { client, profile } = this.getEntry(profileId);
    const folderName = normalizeFolderName(name);
    const key = absoluteStorageKey(profile, joinStorageKey(prefix, `${folderName}/`));
    await client.send(new PutObjectCommand({ Bucket: requiredBucket(profile), Key: key, Body: "" }));
  }

  async copyObject(input: StorageCopyInput): Promise<void> {
    const { client, profile } = this.getEntry(input.profileId);

    if (input.sourceKey.endsWith("/")) {
      await this.copyFolder(client, profile, input);
      return;
    }

    const sourceKey = absoluteStorageKey(profile, input.sourceKey);
    const destinationKey = absoluteStorageKey(profile, input.destinationKey);

    if (!input.overwrite) {
      await assertObjectDoesNotExist(client, profile, destinationKey);
    }

    await this.copyAbsoluteKey(client, profile, sourceKey, destinationKey);
  }

  private async copyFolder(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    input: StorageCopyInput
  ): Promise<void> {
    const sourcePrefix = absoluteStorageKey(profile, input.sourceKey);
    const destinationPrefix = absoluteStorageKey(
      profile,
      input.destinationKey.endsWith("/") ? input.destinationKey : `${input.destinationKey}/`
    );

    const sourceKeys = await this.listAllKeys(client, profile, sourcePrefix);
    if (sourceKeys.length === 0) {
      await client.send(new PutObjectCommand({ Bucket: requiredBucket(profile), Key: destinationPrefix, Body: "" }));
      return;
    }

    if (!input.overwrite) {
      const existing = await client.send(
        new ListObjectsV2Command({ Bucket: requiredBucket(profile), Prefix: destinationPrefix, MaxKeys: 1 })
      );
      if ((existing.Contents ?? []).length > 0 || (existing.CommonPrefixes ?? []).length > 0) {
        throw new Error("Destination folder already exists.");
      }
    }

    for (const absoluteSourceKey of sourceKeys) {
      const destinationKey = destinationPrefix + absoluteSourceKey.slice(sourcePrefix.length);
      await this.copyAbsoluteKey(client, profile, absoluteSourceKey, destinationKey);
    }
  }

  private async copyAbsoluteKey(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    sourceKey: string,
    destinationKey: string
  ): Promise<void> {
    await client.send(
      new CopyObjectCommand({
        Bucket: requiredBucket(profile),
        CopySource: `/${requiredBucket(profile)}/${encodeS3CopySourceKey(sourceKey)}`,
        Key: destinationKey
      })
    );
  }

  async moveObject(input: StorageMoveInput): Promise<void> {
    const isFolder = input.sourceKey.endsWith("/");
    if (!isFolder && input.destinationKey.endsWith("/")) {
      throw new Error("Move destination must be a file key.");
    }

    await this.copyObject(input);

    const { client, profile } = this.getEntry(input.profileId);
    const sourceKeys = isFolder
      ? await this.listAllKeys(client, profile, absoluteStorageKey(profile, input.sourceKey))
      : [absoluteStorageKey(profile, input.sourceKey)];
    await this.deleteAbsoluteKeys(client, profile, sourceKeys);
  }

  async deleteObjects(input: StorageDeleteInput): Promise<void> {
    const { client, profile } = this.getEntry(input.profileId);
    if (input.keys.length === 0) {
      return;
    }

    const absoluteKeys = new Set<string>();
    for (const key of input.keys) {
      const absoluteKey = absoluteStorageKey(profile, key);
      if (key.endsWith("/")) {
        for (const childKey of await this.listAllKeys(client, profile, absoluteKey)) {
          absoluteKeys.add(childKey);
        }
      }
      absoluteKeys.add(absoluteKey);
    }

    await this.deleteAbsoluteKeys(client, profile, [...absoluteKeys]);
  }

  private async deleteAbsoluteKeys(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    keys: string[]
  ): Promise<void> {
    if (keys.length === 1) {
      await client.send(new DeleteObjectCommand({ Bucket: requiredBucket(profile), Key: keys[0] }));
      return;
    }

    for (let index = 0; index < keys.length; index += MAX_DELETE_BATCH) {
      const batch = keys.slice(index, index + MAX_DELETE_BATCH);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: requiredBucket(profile),
          Delete: { Objects: batch.map((key) => ({ Key: key })) }
        })
      );
    }
  }

  private async listAllKeys(
    client: S3Client,
    profile: ConnectionProfile & { password: string },
    absolutePrefix: string
  ): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: requiredBucket(profile),
          Prefix: absolutePrefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000
        })
      );

      for (const object of result.Contents ?? []) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }
      continuationToken = result.NextContinuationToken ?? undefined;
    } while (continuationToken);

    return keys;
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

function defaultPreviewUrlSigner(entry: StorageEntry, key: string, contentType: string | null): Promise<string> {
  return getSignedUrl(
    entry.client,
    new GetObjectCommand({
      Bucket: requiredBucket(entry.profile),
      Key: key,
      ResponseContentType: contentType ?? undefined,
      ResponseContentDisposition: "inline"
    }),
    { expiresIn: PREVIEW_URL_TTL_SECONDS }
  );
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

export function classifyPreview(key: string, contentType: string | null | undefined): StoragePreviewKind {
  const normalizedType = contentType?.toLowerCase() ?? "";
  const extension = extensionForKey(key);

  if (normalizedType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (normalizedType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (normalizedType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  if (normalizedType === "application/pdf" || extension === ".pdf") {
    return "pdf";
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

export { formatStorageBytes };

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

function defaultContentTypeForKind(kind: StoragePreviewKind, key: string): string {
  if (kind === "pdf") {
    return "application/pdf";
  }
  if (kind === "video") {
    return `video/${extensionForKey(key).replace(/^\./, "") || "mp4"}`;
  }
  if (kind === "audio") {
    return `audio/${extensionForKey(key).replace(/^\./, "") || "mpeg"}`;
  }
  return imageContentTypeFromKey(key);
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
  client: S3Client,
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

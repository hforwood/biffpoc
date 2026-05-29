import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { readEnv } from "./config.js";

export type SnapshotKind = "original" | "annotated";

export interface SnapshotObject {
  contentType: string;
  data: Buffer;
  key: string;
}

interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

let s3Client: S3Client | undefined;

export function objectStorageEnabled(): boolean {
  return Boolean(getObjectStorageConfig());
}

export async function saveSnapshotObject(params: {
  leadId: string;
  kind: SnapshotKind;
  contentType: string;
  data: Buffer;
}): Promise<{ key: string }> {
  const config = requireObjectStorageConfig();
  const key = snapshotObjectKey(params.leadId, params.kind);

  await getS3Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: params.data,
      ContentType: params.contentType,
      CacheControl: "private, max-age=300"
    })
  );

  return { key };
}

export async function getSnapshotObject(leadId: string, kind: SnapshotKind): Promise<SnapshotObject | undefined> {
  const config = getObjectStorageConfig();
  if (!config) return undefined;

  const key = snapshotObjectKey(leadId, kind);

  try {
    const response = await getS3Client(config).send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key
      })
    );

    if (!response.Body) return undefined;

    return {
      key,
      contentType: response.ContentType ?? "application/octet-stream",
      data: await bodyToBuffer(response.Body)
    };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function getS3Client(config: ObjectStorageConfig): S3Client {
  s3Client ??= new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return s3Client;
}

function getObjectStorageConfig(): ObjectStorageConfig | undefined {
  const endpoint = readEnv("SUPABASE_S3_ENDPOINT");
  const region = readEnv("SUPABASE_S3_REGION");
  const accessKeyId = readEnv("SUPABASE_S3_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("SUPABASE_S3_SECRET_ACCESS_KEY");
  const bucket = readEnv("SUPABASE_S3_BUCKET");

  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) return undefined;

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucket
  };
}

function requireObjectStorageConfig(): ObjectStorageConfig {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error("Supabase S3 storage is not configured.");
  }
  return config;
}

function snapshotObjectKey(leadId: string, kind: SnapshotKind): string {
  return `site-snapshots/${encodeURIComponent(leadId)}/${kind}`;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  const maybeTransformBody = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybeTransformBody.transformToByteArray === "function") {
    return Buffer.from(await maybeTransformBody.transformToByteArray());
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isNotFound(error: unknown): boolean {
  const metadata =
    typeof error === "object" && error && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      : undefined;
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  return metadata?.httpStatusCode === 404 || name === "NoSuchKey" || name === "NotFound";
}

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/config/env.server";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * File storage, behind a provider interface.
 *
 * Uploads are the classic place where a local-disk shortcut becomes a rewrite
 * later, so the seam is here from the start: callers deal in
 * `StorageProvider.put(...) -> { key, url }` and never in file paths or bucket
 * names. Moving to S3/R2 is implementing `S3StorageProvider.put` and flipping
 * `STORAGE_PROVIDER` — no call site changes, and `key` is already the
 * bucket-relative object key.
 */

export interface StoredObject {
  /** Provider-relative key. Persist this, not the URL. */
  key: string;
  /** Publicly fetchable URL for the stored object. */
  url: string;
  size: number;
  contentType: string;
}

export interface PutOptions {
  /** Logical folder, e.g. "avatars" or "banners". */
  prefix: string;
  contentType: string;
  /** Stable id (usually the user id) so a re-upload replaces predictably. */
  ownerId: string;
}

export interface StorageProvider {
  readonly name: string;
  put(data: Buffer, options: PutOptions): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

/** Only these can be uploaded as images. Enforced by sniffing, not by trust. */
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Detects the real type from magic bytes.
 *
 * The browser-supplied `Content-Type` is attacker-controlled, so it is only
 * used as a cross-check: a file claiming to be a PNG while starting with
 * `<?php` or `<svg` is rejected here rather than being written to disk and
 * later served back to someone.
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/** Validates size and true content type, returning the canonical MIME type. */
export function assertValidImage(buffer: Buffer): string {
  if (buffer.byteLength === 0) throw errors.validation("That file is empty.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw errors.validation("Images have to be under 4MB.");
  }

  const detected = sniffImageType(buffer);
  if (!detected || !ALLOWED_IMAGE_TYPES.has(detected)) {
    throw errors.validation("That is not a supported image. Use JPEG, PNG, WebP or GIF.");
  }

  return detected;
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  async put(data: Buffer, options: PutOptions): Promise<StoredObject> {
    const extension = ALLOWED_IMAGE_TYPES.get(options.contentType) ?? "bin";
    // A content hash in the name means a changed avatar gets a new URL, so CDN
    // and browser caches invalidate themselves.
    const digest = createHash("sha256").update(data).digest("hex").slice(0, 12);
    const key = `${options.prefix}/${options.ownerId}-${digest}.${extension}`;

    const absolute = path.join(process.cwd(), env.STORAGE_LOCAL_DIR, key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);

    return {
      key,
      url: `${env.STORAGE_PUBLIC_BASE_URL}/${key}`,
      size: data.byteLength,
      contentType: options.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    // Refuse anything that tries to climb out of the uploads directory.
    if (key.includes("..") || path.isAbsolute(key)) {
      throw errors.validation("Invalid storage key.");
    }

    const absolute = path.join(process.cwd(), env.STORAGE_LOCAL_DIR, key);
    await unlink(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        logger.warn("Failed to delete local upload", { key, error: String(error) });
      }
    });
  }
}

/**
 * S3-compatible provider (AWS S3, Cloudflare R2, MinIO, ...). Left as the seam
 * rather than a dependency the MVP does not need — `env` already validates the
 * credentials when this provider is selected.
 */
/**
 * Placeholder for an S3-compatible transport.
 *
 * Throws from the constructor rather than from `put`, because the factory below
 * runs at module load: `STORAGE_PROVIDER=s3` therefore takes the process down
 * at boot instead of letting it pass the health check and fail on the first
 * avatar someone uploads.
 */
class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  constructor() {
    throw new Error(
      "STORAGE_PROVIDER=s3 is not implemented yet. Install @aws-sdk/client-s3 and implement put()/delete() here; nothing outside this file needs to change.",
    );
  }

  async put(): Promise<StoredObject> {
    throw new Error("S3 storage is not implemented yet.");
  }

  async delete(): Promise<void> {
    throw new Error("S3 storage is not implemented yet.");
  }
}

function createStorageProvider(): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case "s3":
      return new S3StorageProvider();
    case "local":
    default:
      return new LocalStorageProvider();
  }
}

declare global {
  var __watchgoblinStorage: StorageProvider | undefined;
}

export const storage: StorageProvider =
  globalThis.__watchgoblinStorage ?? (globalThis.__watchgoblinStorage = createStorageProvider());

export { randomUUID };

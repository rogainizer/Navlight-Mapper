import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUploadDirectory } from "../config/uploadConfig.js";

export interface UploadedPhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const uploadRoot = getUploadDirectory();

function sanitizeLocalId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export async function ensureUploadDirectory(): Promise<void> {
  await mkdir(uploadRoot, { recursive: true });
}

export async function saveUploadedPhoto(
  file: UploadedPhotoFile,
  localId: string,
  capturedAt: string
): Promise<{ filePath: string; fileSize: number }> {
  const date = new Date(capturedAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  const directory = path.join(uploadRoot, year, month, day);
  await mkdir(directory, { recursive: true });

  const extension = extensionFromMimeType(file.mimetype);
  const safeLocalId = sanitizeLocalId(localId);
  const fileName = `${safeLocalId}.${extension}`;
  const absolutePath = path.join(directory, fileName);

  await writeFile(absolutePath, file.buffer);

  const relativePath = path.posix.join(year, month, day, fileName);
  return {
    filePath: relativePath,
    fileSize: file.size
  };
}

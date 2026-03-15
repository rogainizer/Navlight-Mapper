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

function sanitizeMapFolderName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown-map";
  }

  const sanitized = trimmed
    .replace(/[\x00-\x1f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[.\s]+$/g, "")
    .trim();

  if (!sanitized) {
    return "unknown-map";
  }

  return sanitized.slice(0, 80);
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
  mapName: string
): Promise<{ filePath: string; fileSize: number }> {
  const safeMapFolder = sanitizeMapFolderName(mapName);
  const directory = path.join(uploadRoot, safeMapFolder);
  await mkdir(directory, { recursive: true });

  const extension = extensionFromMimeType(file.mimetype);
  const safeLocalId = sanitizeLocalId(localId);
  const fileName = `${safeLocalId}.${extension}`;
  const absolutePath = path.join(directory, fileName);

  await writeFile(absolutePath, file.buffer);

  const relativePath = path.posix.join(safeMapFolder, fileName);
  return {
    filePath: relativePath,
    fileSize: file.size
  };
}

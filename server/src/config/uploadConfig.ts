import path from "node:path";

const defaultUploadDir = path.resolve(process.cwd(), "uploads");

export function getUploadDirectory(): string {
  const configured = process.env.UPLOAD_DIR?.trim();

  if (!configured) {
    return defaultUploadDir;
  }

  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

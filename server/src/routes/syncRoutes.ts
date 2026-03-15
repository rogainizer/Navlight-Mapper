import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { withTransaction, pool } from "../db/pool.js";
import { saveUploadedPhoto, type UploadedPhotoFile } from "../services/fileStorage.js";

interface CountRow extends RowDataPacket {
  total: number;
}

interface BatchMetadata {
  batchId: string;
  clientId: string;
  createdAt: string;
  pointCount: number;
  photoCount: number;
}

interface IncomingPoint {
  id: string;
  trackId: string;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: string;
}

interface IncomingPhotoMeta {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
  mimeType: string;
  fileName: string;
  uploadField: string;
}

interface MapFetchRequestBody {
  url?: string;
}

const MAX_MAP_BYTES = 25 * 1024 * 1024;

function parseJsonField<T>(rawValue: unknown, fallback: T): T {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

async function upsertBatch(
  connection: PoolConnection,
  metadata: BatchMetadata,
  status: "processing" | "completed" | "failed",
  errorMessage: string | null = null
): Promise<void> {
  await connection.execute(
    `
    INSERT INTO sync_batches (batch_id, client_id, status, point_count, photo_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      point_count = VALUES(point_count),
      photo_count = VALUES(photo_count),
      error_message = VALUES(error_message)
    `,
    [
      metadata.batchId,
      metadata.clientId,
      status,
      metadata.pointCount,
      metadata.photoCount,
      errorMessage
    ]
  );
}

async function ensureTracks(
  connection: PoolConnection,
  points: IncomingPoint[],
  photosMeta: IncomingPhotoMeta[]
): Promise<void> {
  const trackMap = new Map<string, string>();

  points.forEach((point) => {
    trackMap.set(point.trackId, point.mapId);
  });

  photosMeta.forEach((photo) => {
    if (photo.trackId) {
      trackMap.set(photo.trackId, photo.mapId);
    }
  });

  for (const [trackId, mapId] of trackMap.entries()) {
    await connection.execute(
      `
      INSERT INTO tracks (local_id, map_local_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        map_local_id = VALUES(map_local_id)
      `,
      [trackId, mapId]
    );
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 100,
    fileSize: 20 * 1024 * 1024
  }
});

export const syncRoutes = Router();

syncRoutes.post("/maps/fetch", async (request: Request, response: Response) => {
  const body = (request.body || {}) as MapFetchRequestBody;
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!url) {
    response.status(400).json({ message: "A map URL is required." });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    response.status(400).json({ message: "Map URL is invalid." });
    return;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    response.status(400).json({ message: "Only http/https map URLs are allowed." });
    return;
  }

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Navlight-Mapper/1.0"
      }
    });

    if (!upstream.ok) {
      response
        .status(502)
        .json({ message: `Map host returned ${upstream.status} while downloading image.` });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      response.status(400).json({ message: "Map URL did not return an image." });
      return;
    }

    const contentLengthHeader = upstream.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_MAP_BYTES) {
        response.status(413).json({ message: "Map image is too large (max 25 MB)." });
        return;
      }
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_MAP_BYTES) {
      response.status(413).json({ message: "Map image is too large (max 25 MB)." });
      return;
    }

    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "no-store");
    response.send(Buffer.from(arrayBuffer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch map URL.";
    response.status(502).json({ message: `Unable to fetch map URL: ${message}` });
  }
});

syncRoutes.get("/sync/status", async (_request: Request, response: Response) => {
  const [batchRows] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM sync_batches");
  const [pointRows] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM track_points");
  const [photoRows] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM photos");

  response.json({
    batches: batchRows[0]?.total || 0,
    points: pointRows[0]?.total || 0,
    photos: photoRows[0]?.total || 0
  });
});

syncRoutes.post("/sync/batch", upload.array("photos", 100), async (request: Request, response: Response) => {
  const metadata = parseJsonField<BatchMetadata>(request.body.metadata, {
    batchId: "",
    clientId: "",
    createdAt: new Date().toISOString(),
    pointCount: 0,
    photoCount: 0
  });

  const pointsRaw = parseJsonField<IncomingPoint[] | IncomingPoint>(request.body.points, []);
  const photosMetaRaw = parseJsonField<IncomingPhotoMeta[] | IncomingPhotoMeta>(
    request.body.photosMeta,
    []
  );
  const points = ensureArray(pointsRaw);
  const photosMeta = ensureArray(photosMetaRaw);
  const files = ((request.files as UploadedPhotoFile[]) || []).slice(0, photosMeta.length);

  if (!metadata.batchId || !metadata.clientId) {
    response.status(400).json({ message: "metadata.batchId and metadata.clientId are required." });
    return;
  }

  const syncedPointIds: string[] = [];
  const syncedPhotoIds: string[] = [];
  const failedPhotoIds: string[] = [];

  try {
    await withTransaction(async (connection) => {
      await upsertBatch(connection, metadata, "processing");
      await ensureTracks(connection, points, photosMeta);

      for (const point of points) {
        await connection.execute(
          `
          INSERT INTO track_points
            (local_id, track_local_id, map_local_id, latitude, longitude, accuracy, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            accuracy = VALUES(accuracy),
            recorded_at = VALUES(recorded_at),
            synced_at = CURRENT_TIMESTAMP
          `,
          [point.id, point.trackId, point.mapId, point.lat, point.lng, point.accuracy, point.recordedAt]
        );
        syncedPointIds.push(point.id);
      }

      for (let index = 0; index < photosMeta.length; index += 1) {
        const photoMeta = photosMeta[index];
        const file = files[index];

        if (!file) {
          failedPhotoIds.push(photoMeta.id);
          continue;
        }

        const saved = await saveUploadedPhoto(file, photoMeta.id, photoMeta.capturedAt);

        await connection.execute(
          `
          INSERT INTO photos
            (local_id, track_local_id, map_local_id, latitude, longitude, accuracy, captured_at, mime_type, file_name, file_path, file_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            track_local_id = VALUES(track_local_id),
            map_local_id = VALUES(map_local_id),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            accuracy = VALUES(accuracy),
            captured_at = VALUES(captured_at),
            mime_type = VALUES(mime_type),
            file_name = VALUES(file_name),
            file_path = VALUES(file_path),
            file_size = VALUES(file_size),
            synced_at = CURRENT_TIMESTAMP
          `,
          [
            photoMeta.id,
            photoMeta.trackId,
            photoMeta.mapId,
            photoMeta.lat,
            photoMeta.lng,
            photoMeta.accuracy,
            photoMeta.capturedAt,
            photoMeta.mimeType,
            photoMeta.fileName,
            saved.filePath,
            saved.fileSize
          ]
        );

        syncedPhotoIds.push(photoMeta.id);
      }

      await upsertBatch(connection, metadata, "completed");
    });

    response.json({
      batchId: metadata.batchId,
      syncedPointIds,
      syncedPhotoIds,
      failedPhotoIds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch sync failed";

    try {
      await withTransaction(async (connection) => {
        await upsertBatch(connection, metadata, "failed", message);
      });
    } catch {
      // Ignore secondary failure while reporting primary error.
    }

    response.status(500).json({ message });
  }
});

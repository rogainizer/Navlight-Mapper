import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { withTransaction, pool } from "../db/pool.js";
import { saveUploadedPhoto, type UploadedPhotoFile } from "../services/fileStorage.js";

interface CountRow extends RowDataPacket {
  total: number;
}

interface MapRow extends RowDataPacket {
  local_id: string;
  name: string;
  mime_type: string;
  calibration_json: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MapBlobRow extends RowDataPacket {
  mime_type: string;
  image_blob: Buffer;
}

interface MapPhotoRow extends RowDataPacket {
  local_id: string;
  track_local_id: string | null;
  map_local_id: string;
  latitude: number | string;
  longitude: number | string;
  accuracy: number | string;
  captured_at: string | Date;
  mime_type: string;
  file_name: string;
  file_path: string;
}

interface MapCommentRow extends RowDataPacket {
  local_id: string;
  track_local_id: string | null;
  map_local_id: string;
  latitude: number | string;
  longitude: number | string;
  accuracy: number | string;
  comment_text: string;
  created_at: string | Date;
}

interface MapMarkerRow extends RowDataPacket {
  map_local_id: string;
  marker_type: string;
  latitude: number | string;
  longitude: number | string;
  accuracy: number | string;
}

interface RouteRow extends RowDataPacket {
  local_id: string;
  map_local_id: string;
  name: string;
  color_hex: string;
  points_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MapNameRow extends RowDataPacket {
  local_id: string;
  name: string;
}

interface MapSummaryResponse {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  calibration: unknown | null;
}

interface MapPhotoResponse {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
  mimeType: string;
  fileName: string;
  fileUrl: string;
}

interface MapCommentResponse {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  commentText: string;
  createdAt: string;
}

interface MapMarkerPoint {
  lat: number;
  lng: number;
  accuracy: number;
}

interface MapMarkersResponse {
  pickups: MapMarkerPoint[];
  dropoffs: MapMarkerPoint[];
}

interface UpdateCommentBody {
  commentText?: unknown;
}

interface MapRoutePoint {
  lat: number;
  lng: number;
}

interface MapRouteResponse {
  id: string;
  mapId: string;
  name: string;
  color: string;
  points: MapRoutePoint[];
  createdAt: string;
  updatedAt: string;
}

interface BatchMetadata {
  batchId: string;
  clientId: string;
  createdAt: string;
  pointCount: number;
  photoCount: number;
  commentCount?: number;
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

interface IncomingCommentMeta {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  commentText: string;
  createdAt: string;
}

interface IncomingMapMarkers {
  mapId: string;
  pickups: MapMarkerPoint[];
  dropoffs: MapMarkerPoint[];
}

interface MapFetchRequestBody {
  url?: string;
}

const MAX_MAP_FETCH_BYTES = 25 * 1024 * 1024;
const MAX_MAP_UPLOAD_BYTES = 50 * 1024 * 1024;

class SyncValidationError extends Error {}

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function parseStoredCalibration(raw: string | null): unknown | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeRouteColor(value: string): string {
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new SyncValidationError("route color must be a hex color like #ff6600.");
  }

  return trimmed.toLowerCase();
}

function parseStoredRoutePoints(raw: string): MapRoutePoint[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const points: MapRoutePoint[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const point = item as { lat?: unknown; lng?: unknown };
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      points.push({ lat, lng });
    }

    return points;
  } catch {
    return [];
  }
}

function validateRoutePoints(value: unknown): MapRoutePoint[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new SyncValidationError("route points must contain at least two points.");
  }

  const points = value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new SyncValidationError(`route point at index ${index} is invalid.`);
    }

    const point = item as { lat?: unknown; lng?: unknown };
    const lat = Number(point.lat);
    const lng = Number(point.lng);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new SyncValidationError(`route point ${index} latitude must be between -90 and 90.`);
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new SyncValidationError(`route point ${index} longitude must be between -180 and 180.`);
    }

    return {
      lat,
      lng
    };
  });

  return points;
}

function validateMarkerPoints(value: unknown, fieldName: string): MapMarkerPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new SyncValidationError(`${fieldName}[${index}] is invalid.`);
    }

    const point = item as { lat?: unknown; lng?: unknown; accuracy?: unknown };
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    const accuracy = Number(point.accuracy ?? 0);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new SyncValidationError(`${fieldName}[${index}].lat must be between -90 and 90.`);
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new SyncValidationError(`${fieldName}[${index}].lng must be between -180 and 180.`);
    }

    if (!Number.isFinite(accuracy) || accuracy < 0) {
      throw new SyncValidationError(`${fieldName}[${index}].accuracy must be zero or greater.`);
    }

    return {
      lat,
      lng,
      accuracy
    };
  });
}

function validateIncomingMapMarkers(value: unknown): IncomingMapMarkers[] {
  if (value === null || value === undefined) {
    return [];
  }

  const markerEntries = Array.isArray(value) ? value : [value];
  return markerEntries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new SyncValidationError(`mapMarkers[${index}] must be an object.`);
    }

    const markerPayload = entry as {
      mapId?: unknown;
      pickups?: unknown;
      dropoffs?: unknown;
    };

    const mapId = typeof markerPayload.mapId === "string" ? markerPayload.mapId.trim() : "";
    if (!mapId) {
      throw new SyncValidationError(`mapMarkers[${index}].mapId is required.`);
    }

    return {
      mapId,
      pickups: validateMarkerPoints(markerPayload.pickups, `mapMarkers[${index}].pickups`),
      dropoffs: validateMarkerPoints(markerPayload.dropoffs, `mapMarkers[${index}].dropoffs`)
    };
  });
}

function serializeCalibration(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      throw new SyncValidationError(`${fieldName} must be valid JSON.`);
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    throw new SyncValidationError(`${fieldName} is not serializable.`);
  }
}

function toMapSummary(row: MapRow): MapSummaryResponse {
  return {
    id: row.local_id,
    name: row.name,
    mimeType: row.mime_type,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    calibration: parseStoredCalibration(row.calibration_json)
  };
}

function buildUploadsFileUrl(filePath: string): string {
  const normalized = String(filePath || "").replace(/^\/+/, "");
  if (!normalized) {
    return "/uploads";
  }

  const encodedPath = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/uploads/${encodedPath}`;
}

function toMapPhotoResponse(row: MapPhotoRow): MapPhotoResponse {
  return {
    id: row.local_id,
    trackId: row.track_local_id,
    mapId: row.map_local_id,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    accuracy: Number(row.accuracy),
    capturedAt: toIsoString(row.captured_at),
    mimeType: row.mime_type,
    fileName: row.file_name,
    fileUrl: buildUploadsFileUrl(row.file_path)
  };
}

function toMapCommentResponse(row: MapCommentRow): MapCommentResponse {
  return {
    id: row.local_id,
    trackId: row.track_local_id,
    mapId: row.map_local_id,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    accuracy: Number(row.accuracy),
    commentText: row.comment_text,
    createdAt: toIsoString(row.created_at)
  };
}

function toMapMarkersResponse(rows: MapMarkerRow[]): MapMarkersResponse {
  const markers: MapMarkersResponse = {
    pickups: [],
    dropoffs: []
  };

  for (const row of rows) {
    const point: MapMarkerPoint = {
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      accuracy: Number(row.accuracy)
    };

    if (row.marker_type === "pickup") {
      markers.pickups.push(point);
      continue;
    }

    if (row.marker_type === "dropoff") {
      markers.dropoffs.push(point);
    }
  }

  return markers;
}

function toMapRouteResponse(row: RouteRow): MapRouteResponse {
  return {
    id: row.local_id,
    mapId: row.map_local_id,
    name: row.name,
    color: row.color_hex,
    points: parseStoredRoutePoints(row.points_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function toMySqlDateTime(value: string, fieldName: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SyncValidationError(`${fieldName} must be a valid datetime.`);
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

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
  photosMeta: IncomingPhotoMeta[],
  commentsMeta: IncomingCommentMeta[]
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

  commentsMeta.forEach((comment) => {
    if (comment.trackId) {
      trackMap.set(comment.trackId, comment.mapId);
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

async function loadMapNames(
  connection: PoolConnection,
  mapIds: string[]
): Promise<Map<string, string>> {
  const uniqueMapIds = Array.from(
    new Set(
      mapIds
        .map((mapId) => mapId.trim())
        .filter((mapId) => mapId.length > 0)
    )
  );

  if (uniqueMapIds.length === 0) {
    return new Map();
  }

  const placeholders = uniqueMapIds.map(() => "?").join(", ");
  const [rows] = await connection.query<MapNameRow[]>(
    `
    SELECT local_id, name
    FROM maps
    WHERE local_id IN (${placeholders})
    `,
    uniqueMapIds
  );

  const names = new Map<string, string>();
  for (const row of rows) {
    names.set(row.local_id, row.name);
  }

  return names;
}

async function replaceMapMarkers(connection: PoolConnection, mapMarkers: IncomingMapMarkers): Promise<void> {
  const [mapRows] = await connection.query<RowDataPacket[]>(
    `
    SELECT local_id
    FROM maps
    WHERE local_id = ?
    LIMIT 1
    `,
    [mapMarkers.mapId]
  );

  if (mapRows.length === 0) {
    throw new SyncValidationError("mapMarkers.mapId does not reference a saved map.");
  }

  await connection.execute(
    `
    DELETE FROM map_markers
    WHERE map_local_id = ?
    `,
    [mapMarkers.mapId]
  );

  for (const marker of mapMarkers.pickups) {
    await connection.execute(
      `
      INSERT INTO map_markers (map_local_id, marker_type, latitude, longitude, accuracy)
      VALUES (?, 'pickup', ?, ?, ?)
      `,
      [mapMarkers.mapId, marker.lat, marker.lng, marker.accuracy]
    );
  }

  for (const marker of mapMarkers.dropoffs) {
    await connection.execute(
      `
      INSERT INTO map_markers (map_local_id, marker_type, latitude, longitude, accuracy)
      VALUES (?, 'dropoff', ?, ?, ?)
      `,
      [mapMarkers.mapId, marker.lat, marker.lng, marker.accuracy]
    );
  }
}

const syncUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 100,
    fileSize: 20 * 1024 * 1024
  }
});

const mapUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_MAP_UPLOAD_BYTES
  }
});

export const syncRoutes = Router();

syncRoutes.get("/maps", async (_request: Request, response: Response) => {
  const [rows] = await pool.query<MapRow[]>(
    `
    SELECT local_id, name, mime_type, calibration_json, created_at, updated_at
    FROM maps
    ORDER BY updated_at DESC
    `
  );

  response.json({ maps: rows.map(toMapSummary) });
});

syncRoutes.get("/maps/:mapId/image", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  const [rows] = await pool.query<MapBlobRow[]>(
    `
    SELECT mime_type, image_blob
    FROM maps
    WHERE local_id = ?
    LIMIT 1
    `,
    [mapId]
  );

  const row = rows[0];
  if (!row) {
    response.status(404).json({ message: "Map not found." });
    return;
  }

  response.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  response.send(row.image_blob);
});

syncRoutes.get("/maps/:mapId/photos", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  const [rows] = await pool.query<MapPhotoRow[]>(
    `
    SELECT
      local_id,
      track_local_id,
      map_local_id,
      latitude,
      longitude,
      accuracy,
      captured_at,
      mime_type,
      file_name,
      file_path
    FROM photos
    WHERE map_local_id = ?
    ORDER BY captured_at ASC
    `,
    [mapId]
  );

  response.json({ photos: rows.map(toMapPhotoResponse) });
});

syncRoutes.get("/maps/:mapId/comments", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  const [rows] = await pool.query<MapCommentRow[]>(
    `
    SELECT
      local_id,
      track_local_id,
      map_local_id,
      latitude,
      longitude,
      accuracy,
      comment_text,
      created_at
    FROM comments
    WHERE map_local_id = ?
    ORDER BY created_at ASC
    `,
    [mapId]
  );

  response.json({ comments: rows.map(toMapCommentResponse) });
});

syncRoutes.get("/maps/:mapId/markers", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  const [mapRows] = await pool.query<RowDataPacket[]>(
    `
    SELECT local_id
    FROM maps
    WHERE local_id = ?
    LIMIT 1
    `,
    [mapId]
  );

  if (mapRows.length === 0) {
    response.status(404).json({ message: "Map not found." });
    return;
  }

  const [rows] = await pool.query<MapMarkerRow[]>(
    `
    SELECT map_local_id, marker_type, latitude, longitude, accuracy
    FROM map_markers
    WHERE map_local_id = ?
    ORDER BY id ASC
    `,
    [mapId]
  );

  response.json({ markers: toMapMarkersResponse(rows) });
});

syncRoutes.put("/maps/:mapId/comments/:commentId", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  const commentId = readParam(request.params.commentId);

  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  if (!commentId) {
    response.status(400).json({ message: "Comment id is required." });
    return;
  }

  const body = (request.body || {}) as UpdateCommentBody;
  const commentText = typeof body.commentText === "string" ? body.commentText.trim() : "";

  if (!commentText) {
    response.status(400).json({ message: "commentText is required." });
    return;
  }

  if (commentText.length > 500) {
    response.status(400).json({ message: "commentText must be 500 characters or fewer." });
    return;
  }

  const [existingRows] = await pool.query<RowDataPacket[]>(
    `
    SELECT local_id
    FROM comments
    WHERE local_id = ? AND map_local_id = ?
    LIMIT 1
    `,
    [commentId, mapId]
  );

  if (existingRows.length === 0) {
    response.status(404).json({ message: "Comment not found." });
    return;
  }

  await pool.execute(
    `
    UPDATE comments
    SET comment_text = ?, synced_at = CURRENT_TIMESTAMP
    WHERE local_id = ? AND map_local_id = ?
    `,
    [commentText, commentId, mapId]
  );

  const [rows] = await pool.query<MapCommentRow[]>(
    `
    SELECT
      local_id,
      track_local_id,
      map_local_id,
      latitude,
      longitude,
      accuracy,
      comment_text,
      created_at
    FROM comments
    WHERE local_id = ? AND map_local_id = ?
    LIMIT 1
    `,
    [commentId, mapId]
  );

  const saved = rows[0];
  if (!saved) {
    response.status(500).json({ message: "Failed to update comment." });
    return;
  }

  response.json({ comment: toMapCommentResponse(saved) });
});

syncRoutes.delete("/maps/:mapId/comments/:commentId", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  const commentId = readParam(request.params.commentId);

  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  if (!commentId) {
    response.status(400).json({ message: "Comment id is required." });
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT local_id
    FROM comments
    WHERE local_id = ? AND map_local_id = ?
    LIMIT 1
    `,
    [commentId, mapId]
  );

  if (rows.length === 0) {
    response.status(404).json({ message: "Comment not found." });
    return;
  }

  await pool.execute(
    `
    DELETE FROM comments
    WHERE local_id = ? AND map_local_id = ?
    `,
    [commentId, mapId]
  );

  response.status(204).send();
});

syncRoutes.get("/maps/:mapId/routes", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  const [rows] = await pool.query<RouteRow[]>(
    `
    SELECT local_id, map_local_id, name, color_hex, points_json, created_at, updated_at
    FROM routes
    WHERE map_local_id = ?
    ORDER BY created_at ASC
    `,
    [mapId]
  );

  response.json({ routes: rows.map(toMapRouteResponse) });
});

syncRoutes.post("/maps/:mapId/routes", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  try {
    const body = (request.body || {}) as {
      name?: unknown;
      color?: unknown;
      points?: unknown;
    };

    const routeName = typeof body.name === "string" ? body.name.trim() : "";
    if (!routeName) {
      throw new SyncValidationError("route name is required.");
    }
    if (routeName.length > 120) {
      throw new SyncValidationError("route name must be 120 characters or fewer.");
    }

    const color = typeof body.color === "string" ? normalizeRouteColor(body.color) : "";
    if (!color) {
      throw new SyncValidationError("route color is required.");
    }

    const points = validateRoutePoints(body.points);
    const pointsJson = JSON.stringify(points);
    const routeId = randomUUID();

    const [mapRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT local_id
      FROM maps
      WHERE local_id = ?
      LIMIT 1
      `,
      [mapId]
    );

    if (mapRows.length === 0) {
      response.status(404).json({ message: "Map not found." });
      return;
    }

    await pool.execute(
      `
      INSERT INTO routes (local_id, map_local_id, name, color_hex, points_json)
      VALUES (?, ?, ?, ?, ?)
      `,
      [routeId, mapId, routeName, color, pointsJson]
    );

    const [rows] = await pool.query<RouteRow[]>(
      `
      SELECT local_id, map_local_id, name, color_hex, points_json, created_at, updated_at
      FROM routes
      WHERE local_id = ?
      LIMIT 1
      `,
      [routeId]
    );

    const saved = rows[0];
    if (!saved) {
      response.status(500).json({ message: "Failed to save route." });
      return;
    }

    response.status(201).json({ route: toMapRouteResponse(saved) });
  } catch (error) {
    if (error instanceof SyncValidationError) {
      response.status(400).json({ message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to save route.";
    response.status(500).json({ message });
  }
});

syncRoutes.delete("/maps/:mapId/routes/:routeId", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  const routeId = readParam(request.params.routeId);

  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  if (!routeId) {
    response.status(400).json({ message: "Route id is required." });
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT local_id
    FROM routes
    WHERE local_id = ? AND map_local_id = ?
    LIMIT 1
    `,
    [routeId, mapId]
  );

  if (rows.length === 0) {
    response.status(404).json({ message: "Route not found." });
    return;
  }

  await pool.execute(
    `
    DELETE FROM routes
    WHERE local_id = ? AND map_local_id = ?
    `,
    [routeId, mapId]
  );

  response.status(204).send();
});

syncRoutes.post("/maps", mapUpload.single("map"), async (request: Request, response: Response) => {
  const file = request.file;
  if (!file) {
    response.status(400).json({ message: "Map image file is required." });
    return;
  }

  if (!file.mimetype.startsWith("image/")) {
    response.status(400).json({ message: "Map file must be an image." });
    return;
  }

  const requestedMapId = typeof request.body.mapId === "string" ? request.body.mapId.trim() : "";
  const mapId = requestedMapId.length > 0 ? requestedMapId : randomUUID();
  const requestedName = typeof request.body.name === "string" ? request.body.name.trim() : "";
  const mapName = requestedName.length > 0 ? requestedName : file.originalname || "Untitled Map";

  try {
    const calibrationJson = serializeCalibration(request.body.calibration, "calibration");

    await pool.execute(
      `
      INSERT INTO maps (local_id, name, mime_type, image_blob, calibration_json)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        mime_type = VALUES(mime_type),
        image_blob = VALUES(image_blob),
        calibration_json = COALESCE(VALUES(calibration_json), calibration_json),
        updated_at = CURRENT_TIMESTAMP
      `,
      [mapId, mapName, file.mimetype, file.buffer, calibrationJson]
    );

    const [rows] = await pool.query<MapRow[]>(
      `
      SELECT local_id, name, mime_type, calibration_json, created_at, updated_at
      FROM maps
      WHERE local_id = ?
      LIMIT 1
      `,
      [mapId]
    );

    const saved = rows[0];
    if (!saved) {
      response.status(500).json({ message: "Failed to save map." });
      return;
    }

    response.json({ map: toMapSummary(saved) });
  } catch (error) {
    if (error instanceof SyncValidationError) {
      response.status(400).json({ message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to save map.";
    response.status(500).json({ message });
  }
});

syncRoutes.put("/maps/:mapId/calibration", async (request: Request, response: Response) => {
  const mapId = readParam(request.params.mapId);
  if (!mapId) {
    response.status(400).json({ message: "Map id is required." });
    return;
  }

  try {
    const body = (request.body || {}) as { calibration?: unknown };
    const calibrationJson = serializeCalibration(body.calibration, "calibration");

    await pool.execute(
      `
      UPDATE maps
      SET calibration_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE local_id = ?
      `,
      [calibrationJson, mapId]
    );

    const [rows] = await pool.query<MapRow[]>(
      `
      SELECT local_id, name, mime_type, calibration_json, created_at, updated_at
      FROM maps
      WHERE local_id = ?
      LIMIT 1
      `,
      [mapId]
    );

    const saved = rows[0];
    if (!saved) {
      response.status(404).json({ message: "Map not found." });
      return;
    }

    response.json({ map: toMapSummary(saved) });
  } catch (error) {
    if (error instanceof SyncValidationError) {
      response.status(400).json({ message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Failed to save calibration.";
    response.status(500).json({ message });
  }
});

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
      if (Number.isFinite(contentLength) && contentLength > MAX_MAP_FETCH_BYTES) {
        response.status(413).json({ message: "Map image is too large (max 25 MB)." });
        return;
      }
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_MAP_FETCH_BYTES) {
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
  const [commentRows] = await pool.query<CountRow[]>("SELECT COUNT(*) AS total FROM comments");

  response.json({
    batches: batchRows[0]?.total || 0,
    points: pointRows[0]?.total || 0,
    photos: photoRows[0]?.total || 0,
    comments: commentRows[0]?.total || 0
  });
});

syncRoutes.post("/sync/batch", syncUpload.array("photos", 100), async (request: Request, response: Response) => {
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
  const commentsMetaRaw = parseJsonField<IncomingCommentMeta[] | IncomingCommentMeta>(
    request.body.commentsMeta,
    []
  );
  const mapMarkersRaw = parseJsonField<IncomingMapMarkers[] | IncomingMapMarkers | null>(request.body.mapMarkers, null);
  const points = ensureArray(pointsRaw);
  const photosMeta = ensureArray(photosMetaRaw);
  const commentsMeta = ensureArray(commentsMetaRaw);
  const mapMarkers = validateIncomingMapMarkers(mapMarkersRaw);
  const files = ((request.files as UploadedPhotoFile[]) || []).slice(0, photosMeta.length);

  if (!metadata.batchId || !metadata.clientId) {
    response.status(400).json({ message: "metadata.batchId and metadata.clientId are required." });
    return;
  }

  const syncedPointIds: string[] = [];
  const syncedPhotoIds: string[] = [];
  const failedPhotoIds: string[] = [];
  const syncedCommentIds: string[] = [];
  const failedCommentIds: string[] = [];

  try {
    await withTransaction(async (connection) => {
      await upsertBatch(connection, metadata, "processing");
      await ensureTracks(connection, points, photosMeta, commentsMeta);

      for (const markerState of mapMarkers) {
        await replaceMapMarkers(connection, markerState);
      }

      const mapNames = await loadMapNames(
        connection,
        photosMeta.map((photo) => photo.mapId)
      );

      for (const point of points) {
        const recordedAt = toMySqlDateTime(point.recordedAt, "points[].recordedAt");

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
          [point.id, point.trackId, point.mapId, point.lat, point.lng, point.accuracy, recordedAt]
        );
        syncedPointIds.push(point.id);
      }

      for (let index = 0; index < photosMeta.length; index += 1) {
        const photoMeta = photosMeta[index];
        const file = files[index];
        const capturedAt = toMySqlDateTime(photoMeta.capturedAt, "photosMeta[].capturedAt");

        if (!file) {
          failedPhotoIds.push(photoMeta.id);
          continue;
        }

        const mapName = mapNames.get(photoMeta.mapId) || photoMeta.mapId;
        const saved = await saveUploadedPhoto(file, photoMeta.id, mapName);

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
            capturedAt,
            photoMeta.mimeType,
            photoMeta.fileName,
            saved.filePath,
            saved.fileSize
          ]
        );

        syncedPhotoIds.push(photoMeta.id);
      }

      for (const commentMeta of commentsMeta) {
        const createdAt = toMySqlDateTime(commentMeta.createdAt, "commentsMeta[].createdAt");

        if (!commentMeta.commentText || commentMeta.commentText.trim().length === 0) {
          failedCommentIds.push(commentMeta.id);
          continue;
        }

        await connection.execute(
          `
          INSERT INTO comments
            (local_id, track_local_id, map_local_id, latitude, longitude, accuracy, comment_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            track_local_id = VALUES(track_local_id),
            map_local_id = VALUES(map_local_id),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            accuracy = VALUES(accuracy),
            comment_text = VALUES(comment_text),
            created_at = VALUES(created_at),
            synced_at = CURRENT_TIMESTAMP
          `,
          [
            commentMeta.id,
            commentMeta.trackId,
            commentMeta.mapId,
            commentMeta.lat,
            commentMeta.lng,
            commentMeta.accuracy,
            commentMeta.commentText.trim(),
            createdAt
          ]
        );

        syncedCommentIds.push(commentMeta.id);
      }

      await upsertBatch(connection, metadata, "completed");
    });

    response.json({
      batchId: metadata.batchId,
      syncedPointIds,
      syncedPhotoIds,
      failedPhotoIds,
      syncedCommentIds,
      failedCommentIds,
      syncedMarkerMapIds: mapMarkers.map((markerState) => markerState.mapId)
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

    if (error instanceof SyncValidationError) {
      response.status(400).json({ message: error.message });
      return;
    }

    response.status(500).json({ message });
  }
});

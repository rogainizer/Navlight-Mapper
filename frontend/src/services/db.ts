import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  CalibrationModel,
  CommentRecord,
  MapRecord,
  PendingCounts,
  PhotoRecord,
  TrackPointRecord,
  TrackRecord
} from "../types";

interface MapperDB extends DBSchema {
  maps: {
    key: string;
    value: MapRecord;
    indexes: {
      "by-createdAt": string;
    };
  };
  tracks: {
    key: string;
    value: TrackRecord;
    indexes: {
      "by-mapId": string;
      "by-syncStatus": string;
    };
  };
  points: {
    key: string;
    value: TrackPointRecord;
    indexes: {
      "by-mapId": string;
      "by-trackId": string;
      "by-syncStatus": string;
    };
  };
  photos: {
    key: string;
    value: PhotoRecord;
    indexes: {
      "by-mapId": string;
      "by-trackId": string;
      "by-syncStatus": string;
    };
  };
  comments: {
    key: string;
    value: CommentRecord;
    indexes: {
      "by-mapId": string;
      "by-trackId": string;
      "by-syncStatus": string;
    };
  };
}

const DB_NAME = "navlight-mapper";
const DB_VERSION = 2;

function normalizeCalibration(calibration: CalibrationModel | null): CalibrationModel | null {
  if (!calibration) {
    return null;
  }

  const controlPoints = calibration.controlPoints.map((point) => ({
    imageX: Number(point.imageX),
    imageY: Number(point.imageY),
    lat: Number(point.lat),
    lng: Number(point.lng)
  })) as CalibrationModel["controlPoints"];

  const coefficients = calibration.coefficients.map((value) => Number(value)) as CalibrationModel["coefficients"];

  return {
    controlPoints,
    coefficients
  };
}

function toStoredMapRecord(map: MapRecord): MapRecord {
  return {
    id: String(map.id),
    name: String(map.name),
    blob: map.blob,
    createdAt: String(map.createdAt),
    calibration: normalizeCalibration(map.calibration)
  };
}

function toStoredPhotoRecord(photo: PhotoRecord): PhotoRecord {
  return {
    id: String(photo.id),
    trackId: photo.trackId,
    mapId: String(photo.mapId),
    lat: Number(photo.lat),
    lng: Number(photo.lng),
    accuracy: Number(photo.accuracy),
    capturedAt: String(photo.capturedAt),
    fileName: String(photo.fileName),
    mimeType: String(photo.mimeType),
    blob: photo.blob,
    syncStatus: photo.syncStatus,
    lastError: photo.lastError
  };
}

function toStoredCommentRecord(comment: CommentRecord): CommentRecord {
  return {
    id: String(comment.id),
    trackId: comment.trackId,
    mapId: String(comment.mapId),
    lat: Number(comment.lat),
    lng: Number(comment.lng),
    accuracy: Number(comment.accuracy),
    commentText: String(comment.commentText),
    createdAt: String(comment.createdAt),
    syncStatus: comment.syncStatus,
    lastError: comment.lastError
  };
}

function ensureStores(db: IDBPDatabase<MapperDB>): void {
  if (!db.objectStoreNames.contains("maps")) {
    const mapStore = db.createObjectStore("maps", { keyPath: "id" });
    mapStore.createIndex("by-createdAt", "createdAt");
  }

  if (!db.objectStoreNames.contains("tracks")) {
    const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
    trackStore.createIndex("by-mapId", "mapId");
    trackStore.createIndex("by-syncStatus", "syncStatus");
  }

  if (!db.objectStoreNames.contains("points")) {
    const pointStore = db.createObjectStore("points", { keyPath: "id" });
    pointStore.createIndex("by-mapId", "mapId");
    pointStore.createIndex("by-trackId", "trackId");
    pointStore.createIndex("by-syncStatus", "syncStatus");
  }

  if (!db.objectStoreNames.contains("photos")) {
    const photoStore = db.createObjectStore("photos", { keyPath: "id" });
    photoStore.createIndex("by-mapId", "mapId");
    photoStore.createIndex("by-trackId", "trackId");
    photoStore.createIndex("by-syncStatus", "syncStatus");
  }

  if (!db.objectStoreNames.contains("comments")) {
    const commentStore = db.createObjectStore("comments", { keyPath: "id" });
    commentStore.createIndex("by-mapId", "mapId");
    commentStore.createIndex("by-trackId", "trackId");
    commentStore.createIndex("by-syncStatus", "syncStatus");
  }
}

const dbPromise = openDB<MapperDB>(DB_NAME, DB_VERSION, {
  upgrade(db: IDBPDatabase<MapperDB>) {
    ensureStores(db);
  }
});

export async function listMaps(): Promise<MapRecord[]> {
  const db = await dbPromise;
  const maps: MapRecord[] = await db.getAll("maps");
  return maps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveMap(map: MapRecord): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction("maps", "readwrite");
  await tx.store.clear();
  await tx.store.put(toStoredMapRecord(map));
  await tx.done;
}

export async function clearLocalMapSessionData(): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["maps", "tracks", "points", "photos", "comments"], "readwrite");

  await Promise.all([
    tx.objectStore("maps").clear(),
    tx.objectStore("tracks").clear(),
    tx.objectStore("points").clear(),
    tx.objectStore("photos").clear(),
    tx.objectStore("comments").clear()
  ]);

  await tx.done;
}

export async function updateMapCalibration(mapId: string, calibration: CalibrationModel): Promise<void> {
  const db = await dbPromise;
  const map = await db.get("maps", mapId);
  if (!map) {
    throw new Error("Map not found while saving calibration.");
  }
  map.calibration = normalizeCalibration(calibration);
  await db.put("maps", map);
}

export async function saveTrack(track: TrackRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("tracks", track);
}

export async function completeTrack(trackId: string, endedAt: string): Promise<void> {
  const db = await dbPromise;
  const track = await db.get("tracks", trackId);
  if (!track) {
    return;
  }
  track.endedAt = endedAt;
  track.syncStatus = "pending";
  await db.put("tracks", track);
}

export async function savePoint(point: TrackPointRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("points", point);
}

export async function listPointsByMap(mapId: string): Promise<TrackPointRecord[]> {
  const db = await dbPromise;
  const points: TrackPointRecord[] = await db.getAllFromIndex("points", "by-mapId", mapId);
  return points.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function listPendingPoints(): Promise<TrackPointRecord[]> {
  const db = await dbPromise;
  return db.getAllFromIndex("points", "by-syncStatus", "pending");
}

export async function markPointsSynced(pointIds: string[]): Promise<void> {
  if (pointIds.length === 0) {
    return;
  }
  const db = await dbPromise;
  const tx = db.transaction("points", "readwrite");
  for (const pointId of pointIds) {
    const point = await tx.store.get(pointId);
    if (!point) {
      continue;
    }
    point.syncStatus = "synced";
    await tx.store.put(point);
  }
  await tx.done;
}

export async function savePhoto(photo: PhotoRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("photos", toStoredPhotoRecord(photo));
}

export async function replacePhotosForMap(mapId: string, photos: PhotoRecord[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction("photos", "readwrite");

  const existingIds = await tx.store.index("by-mapId").getAllKeys(mapId);
  for (const existingId of existingIds) {
    await tx.store.delete(String(existingId));
  }

  for (const photo of photos) {
    await tx.store.put(toStoredPhotoRecord(photo));
  }

  await tx.done;
}

export async function saveComment(comment: CommentRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("comments", toStoredCommentRecord(comment));
}

export async function replaceCommentsForMap(mapId: string, comments: CommentRecord[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction("comments", "readwrite");

  const existingIds = await tx.store.index("by-mapId").getAllKeys(mapId);
  for (const existingId of existingIds) {
    await tx.store.delete(String(existingId));
  }

  for (const comment of comments) {
    await tx.store.put(toStoredCommentRecord(comment));
  }

  await tx.done;
}

export async function deletePhoto(photoId: string): Promise<void> {
  const db = await dbPromise;
  await db.delete("photos", photoId);
}

export async function deleteComment(commentId: string): Promise<void> {
  const db = await dbPromise;
  await db.delete("comments", commentId);
}

export async function listPhotosByMap(mapId: string): Promise<PhotoRecord[]> {
  const db = await dbPromise;
  const photos: PhotoRecord[] = await db.getAllFromIndex("photos", "by-mapId", mapId);
  return photos.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function listPendingPhotos(): Promise<PhotoRecord[]> {
  const db = await dbPromise;
  const [pending, failed] = await Promise.all([
    db.getAllFromIndex("photos", "by-syncStatus", "pending"),
    db.getAllFromIndex("photos", "by-syncStatus", "failed")
  ]);
  return [...pending, ...failed];
}

export async function listPendingPhotosForMap(mapId: string): Promise<PhotoRecord[]> {
  const db = await dbPromise;
  const photos: PhotoRecord[] = await db.getAllFromIndex("photos", "by-mapId", mapId);
  return photos
    .filter((photo) => photo.syncStatus === "pending" || photo.syncStatus === "failed")
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function listCommentsByMap(mapId: string): Promise<CommentRecord[]> {
  const db = await dbPromise;
  const comments: CommentRecord[] = await db.getAllFromIndex("comments", "by-mapId", mapId);
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listPendingCommentsForMap(mapId: string): Promise<CommentRecord[]> {
  const db = await dbPromise;
  const comments: CommentRecord[] = await db.getAllFromIndex("comments", "by-mapId", mapId);
  return comments
    .filter((comment) => comment.syncStatus === "pending" || comment.syncStatus === "failed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markCommentsSynced(commentIds: string[]): Promise<void> {
  if (commentIds.length === 0) {
    return;
  }

  const db = await dbPromise;
  const tx = db.transaction("comments", "readwrite");
  for (const commentId of commentIds) {
    const comment = await tx.store.get(commentId);
    if (!comment) {
      continue;
    }

    comment.syncStatus = "synced";
    comment.lastError = null;
    await tx.store.put(comment);
  }

  await tx.done;
}

export async function markCommentsFailed(commentIds: string[], reason: string): Promise<void> {
  if (commentIds.length === 0) {
    return;
  }

  const db = await dbPromise;
  const tx = db.transaction("comments", "readwrite");
  for (const commentId of commentIds) {
    const comment = await tx.store.get(commentId);
    if (!comment) {
      continue;
    }

    comment.syncStatus = "failed";
    comment.lastError = reason;
    await tx.store.put(comment);
  }

  await tx.done;
}

export async function markPhotosSynced(photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) {
    return;
  }
  const db = await dbPromise;
  const tx = db.transaction("photos", "readwrite");
  for (const photoId of photoIds) {
    const photo = await tx.store.get(photoId);
    if (!photo) {
      continue;
    }
    photo.syncStatus = "synced";
    photo.lastError = null;
    await tx.store.put(photo);
  }
  await tx.done;
}

export async function markPhotosFailed(photoIds: string[], reason: string): Promise<void> {
  if (photoIds.length === 0) {
    return;
  }
  const db = await dbPromise;
  const tx = db.transaction("photos", "readwrite");
  for (const photoId of photoIds) {
    const photo = await tx.store.get(photoId);
    if (!photo) {
      continue;
    }
    photo.syncStatus = "failed";
    photo.lastError = reason;
    await tx.store.put(photo);
  }
  await tx.done;
}

export async function getPendingCounts(): Promise<PendingCounts> {
  const db = await dbPromise;
  const [points, pendingPhotos, failedPhotos, pendingComments, failedComments] = await Promise.all([
    db.countFromIndex("points", "by-syncStatus", "pending"),
    db.countFromIndex("photos", "by-syncStatus", "pending"),
    db.countFromIndex("photos", "by-syncStatus", "failed"),
    db.countFromIndex("comments", "by-syncStatus", "pending"),
    db.countFromIndex("comments", "by-syncStatus", "failed")
  ]);

  return {
    points,
    photos: pendingPhotos + failedPhotos,
    comments: pendingComments + failedComments
  };
}

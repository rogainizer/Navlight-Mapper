import {
  listPendingCommentsForMap,
  listPendingPhotosForMap,
  listPendingPoints,
  markCommentsFailed,
  markCommentsSynced,
  markPhotosFailed,
  markPhotosSynced,
  markPointsSynced
} from "./db";
import { uploadSyncBatch } from "./api";
import type { MapMarkersSyncPayload } from "../types";

interface SyncOutcome {
  syncedPoints: number;
  syncedPhotos: number;
  failedPhotos: number;
  syncedComments: number;
  failedComments: number;
  syncedMarkers: number;
  syncedMarkerState: boolean;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export async function syncPendingRecords(
  clientId: string,
  activeMapId: string | null,
  mapMarkers: MapMarkersSyncPayload[]
): Promise<SyncOutcome> {
  const [pendingPoints, pendingPhotos, pendingComments] = await Promise.all([
    listPendingPoints(),
    activeMapId ? listPendingPhotosForMap(activeMapId) : Promise.resolve([]),
    activeMapId ? listPendingCommentsForMap(activeMapId) : Promise.resolve([])
  ]);

  if (pendingPoints.length === 0 && pendingPhotos.length === 0 && pendingComments.length === 0 && mapMarkers.length === 0) {
    return {
      syncedPoints: 0,
      syncedPhotos: 0,
      failedPhotos: 0,
      syncedComments: 0,
      failedComments: 0,
      syncedMarkers: 0,
      syncedMarkerState: false
    };
  }

  const batchId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const formData = new FormData();
  formData.set(
    "metadata",
    JSON.stringify({
      batchId,
      clientId,
      createdAt,
      pointCount: pendingPoints.length,
      photoCount: pendingPhotos.length,
      commentCount: pendingComments.length
    })
  );

  if (mapMarkers.length > 0) {
    formData.set("mapMarkers", JSON.stringify(mapMarkers));
  }

  formData.set(
    "points",
    JSON.stringify(
      pendingPoints.map((point) => ({
        id: point.id,
        trackId: point.trackId,
        mapId: point.mapId,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        recordedAt: point.recordedAt
      }))
    )
  );

  formData.set(
    "photosMeta",
    JSON.stringify(
      pendingPhotos.map((photo, index) => ({
        id: photo.id,
        trackId: photo.trackId,
        mapId: photo.mapId,
        lat: photo.lat,
        lng: photo.lng,
        accuracy: photo.accuracy,
        capturedAt: photo.capturedAt,
        mimeType: photo.mimeType,
        fileName: photo.fileName,
        uploadField: `photo-${index}`
      }))
    )
  );

  pendingPhotos.forEach((photo, index) => {
    const extension = extensionForMimeType(photo.mimeType);
    formData.append("photos", photo.blob, `${photo.id}.${extension}`);
    formData.append("photoFields", `photo-${index}`);
  });

  formData.set(
    "commentsMeta",
    JSON.stringify(
      pendingComments.map((comment) => ({
        id: comment.id,
        trackId: comment.trackId,
        mapId: comment.mapId,
        lat: comment.lat,
        lng: comment.lng,
        accuracy: comment.accuracy,
        commentText: comment.commentText,
        createdAt: comment.createdAt
      }))
    )
  );

  try {
    const response = await uploadSyncBatch(formData);
    await Promise.all([
      markPointsSynced(response.syncedPointIds),
      markPhotosSynced(response.syncedPhotoIds),
      markPhotosFailed(response.failedPhotoIds, "Photo upload failed on server."),
      markCommentsSynced(response.syncedCommentIds),
      markCommentsFailed(response.failedCommentIds, "Comment upload failed on server.")
    ]);

    return {
      syncedPoints: response.syncedPointIds.length,
      syncedPhotos: response.syncedPhotoIds.length,
      failedPhotos: response.failedPhotoIds.length,
      syncedComments: response.syncedCommentIds.length,
      failedComments: response.failedCommentIds.length,
      syncedMarkers: mapMarkers.reduce((total, markerState) => total + markerState.pickups.length + markerState.dropoffs.length, 0),
      syncedMarkerState: mapMarkers.length > 0
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown sync error";
    await Promise.all([
      markPhotosFailed(
        pendingPhotos.map((photo) => photo.id),
        reason
      ),
      markCommentsFailed(
        pendingComments.map((comment) => comment.id),
        reason
      )
    ]);
    throw error;
  }
}

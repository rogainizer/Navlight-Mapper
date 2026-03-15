import {
  listPendingPhotos,
  listPendingPoints,
  markPhotosFailed,
  markPhotosSynced,
  markPointsSynced
} from "./db";
import { uploadSyncBatch } from "./api";

interface SyncOutcome {
  syncedPoints: number;
  syncedPhotos: number;
  failedPhotos: number;
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

export async function syncPendingRecords(clientId: string): Promise<SyncOutcome> {
  const [pendingPoints, pendingPhotos] = await Promise.all([listPendingPoints(), listPendingPhotos()]);

  if (pendingPoints.length === 0 && pendingPhotos.length === 0) {
    return { syncedPoints: 0, syncedPhotos: 0, failedPhotos: 0 };
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
      photoCount: pendingPhotos.length
    })
  );

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

  try {
    const response = await uploadSyncBatch(formData);
    await Promise.all([
      markPointsSynced(response.syncedPointIds),
      markPhotosSynced(response.syncedPhotoIds),
      markPhotosFailed(response.failedPhotoIds, "Photo upload failed on server.")
    ]);

    return {
      syncedPoints: response.syncedPointIds.length,
      syncedPhotos: response.syncedPhotoIds.length,
      failedPhotos: response.failedPhotoIds.length
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown sync error";
    await markPhotosFailed(
      pendingPhotos.map((photo) => photo.id),
      reason
    );
    throw error;
  }
}

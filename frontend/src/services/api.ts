import type {
  CalibrationModel,
  CommentRecord,
  RoutePoint,
  ServerMapSummary,
  ServerRoute
} from "../types";

export interface SyncBatchResponse {
  batchId: string;
  syncedPointIds: string[];
  syncedPhotoIds: string[];
  failedPhotoIds: string[];
  syncedCommentIds: string[];
  failedCommentIds: string[];
}

interface ApiErrorBody {
  message?: string;
}

interface ServerMapsListResponse {
  maps: ServerMapSummary[];
}

interface ServerMapSingleResponse {
  map: ServerMapSummary;
}

interface ServerMapPhotosResponse {
  photos: ServerMapPhoto[];
}

interface ServerMapCommentsResponse {
  comments: ServerMapComment[];
}

interface ServerMapCommentSingleResponse {
  comment: ServerMapComment;
}

interface ServerMapRoutesResponse {
  routes: ServerRoute[];
}

interface ServerRouteSingleResponse {
  route: ServerRoute;
}

export interface ServerMapPhoto {
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

export interface ServerMapComment {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  commentText: string;
  createdAt: string;
}

export interface SaveMapToServerInput {
  mapId?: string;
  name: string;
  mapBlob: Blob;
  fileName?: string;
  calibration?: CalibrationModel | null;
}

export interface SaveMapRouteToServerInput {
  name: string;
  color: string;
  points: RoutePoint[];
}

export interface UpdateMapCommentInput {
  commentText: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const errorBody = (await response.json()) as ApiErrorBody;
    if (errorBody.message) {
      return errorBody.message;
    }
  } catch {
    const text = await response.text();
    if (text) {
      return text;
    }
  }

  return fallback;
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

export async function uploadSyncBatch(formData: FormData): Promise<SyncBatchResponse> {
  const response = await fetch(`${API_BASE_URL}/sync/batch`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Sync request failed.");
    throw new Error(message);
  }

  return (await response.json()) as SyncBatchResponse;
}

export async function listServerMaps(): Promise<ServerMapSummary[]> {
  const response = await fetch(`${API_BASE_URL}/maps`, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to load server maps.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapsListResponse;
  return data.maps || [];
}

export async function fetchServerMapImage(mapId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/image`, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to download map image.");
    throw new Error(message);
  }

  return response.blob();
}

export async function listServerMapPhotos(mapId: string): Promise<ServerMapPhoto[]> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/photos`, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to load map photos.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapPhotosResponse;
  return data.photos || [];
}

export async function listServerMapComments(mapId: string): Promise<ServerMapComment[]> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/comments`, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to load map comments.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapCommentsResponse;
  return data.comments || [];
}

export async function updateMapCommentOnServer(
  mapId: string,
  commentId: string,
  payload: UpdateMapCommentInput
): Promise<ServerMapComment> {
  const response = await fetch(
    `${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to update map comment.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapCommentSingleResponse;
  return data.comment;
}

export async function deleteMapCommentFromServer(mapId: string, commentId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to delete map comment.");
    throw new Error(message);
  }
}

export function toLocalCommentRecord(comment: ServerMapComment): CommentRecord {
  return {
    id: comment.id,
    trackId: comment.trackId,
    mapId: comment.mapId,
    lat: comment.lat,
    lng: comment.lng,
    accuracy: comment.accuracy,
    commentText: comment.commentText,
    createdAt: comment.createdAt,
    syncStatus: "synced",
    lastError: null
  };
}

export async function listServerMapRoutes(mapId: string): Promise<ServerRoute[]> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/routes`, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to load map routes.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapRoutesResponse;
  return data.routes || [];
}

export async function saveMapRouteToServer(
  mapId: string,
  payload: SaveMapRouteToServerInput
): Promise<ServerRoute> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/routes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to save map route.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerRouteSingleResponse;
  return data.route;
}

export async function deleteMapRouteFromServer(mapId: string, routeId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/routes/${encodeURIComponent(routeId)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to delete map route.");
    throw new Error(message);
  }
}

export async function fetchServerMapPhotoBlob(fileUrl: string): Promise<Blob> {
  const response = await fetch(fileUrl, {
    method: "GET"
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to download map photo.");
    throw new Error(message);
  }

  return response.blob();
}

export async function saveMapToServer(payload: SaveMapToServerInput): Promise<ServerMapSummary> {
  const mapMimeType = payload.mapBlob.type || "image/jpeg";
  const extension = extensionForMimeType(mapMimeType);
  const fileName = payload.fileName || `${payload.name.replace(/\s+/g, "-").toLowerCase()}.${extension}`;

  const formData = new FormData();
  formData.set("name", payload.name);
  if (payload.mapId) {
    formData.set("mapId", payload.mapId);
  }
  if (payload.calibration !== undefined) {
    formData.set("calibration", JSON.stringify(payload.calibration));
  }
  formData.set("map", payload.mapBlob, fileName);

  const response = await fetch(`${API_BASE_URL}/maps`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to save map to server.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapSingleResponse;
  return data.map;
}

export async function saveMapCalibrationToServer(
  mapId: string,
  calibration: CalibrationModel
): Promise<ServerMapSummary> {
  const response = await fetch(`${API_BASE_URL}/maps/${encodeURIComponent(mapId)}/calibration`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ calibration })
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Failed to save map calibration on server.");
    throw new Error(message);
  }

  const data = (await response.json()) as ServerMapSingleResponse;
  return data.map;
}

export async function fetchMapBlobFromUrl(url: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/maps/fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, "Map download failed.");
    throw new Error(message);
  }

  return response.blob();
}

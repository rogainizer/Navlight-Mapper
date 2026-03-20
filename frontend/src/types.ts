export type SyncStatus = "pending" | "synced" | "failed";
export type PhotoLocationMode = "current" | "map";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface MapMarkersState {
  pickups: GeoPoint[];
  dropoffs: GeoPoint[];
}

export interface MapMarkersSyncPayload extends MapMarkersState {
  mapId: string;
}

export interface ImagePoint {
  x: number;
  y: number;
}

export interface ControlPoint {
  imageX: number;
  imageY: number;
  lat: number;
  lng: number;
}

export interface CalibrationModel {
  controlPoints: [ControlPoint, ControlPoint, ControlPoint];
  coefficients: [number, number, number, number, number, number];
}

export interface MapRecord {
  id: string;
  name: string;
  blob: Blob;
  createdAt: string;
  calibration: CalibrationModel | null;
}

export interface ServerMapSummary {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  calibration: CalibrationModel | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface ServerRoute {
  id: string;
  mapId: string;
  name: string;
  color: string;
  points: RoutePoint[];
  createdAt: string;
  updatedAt: string;
}

export interface TrackRecord {
  id: string;
  mapId: string;
  startedAt: string;
  endedAt: string | null;
  syncStatus: SyncStatus;
}

export interface TrackPointRecord {
  id: string;
  trackId: string;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: string;
  syncStatus: SyncStatus;
}

export interface PhotoRecord {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  syncStatus: SyncStatus;
  lastError: string | null;
}

export interface CommentRecord {
  id: string;
  trackId: string | null;
  mapId: string;
  lat: number;
  lng: number;
  accuracy: number;
  commentText: string;
  createdAt: string;
  syncStatus: SyncStatus;
  lastError: string | null;
}

export interface LivePosition {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface PendingCounts {
  points: number;
  photos: number;
  comments: number;
}

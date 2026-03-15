<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>Navlight Mapper</h1>
      <div class="header-meta">
        <span><strong>Network:</strong> {{ online ? "Online" : "Offline" }}</span>
        <span><strong>GPS:</strong> {{ currentPosition ? `±${Math.round(currentPosition.accuracy)}m` : "Waiting" }}</span>
        <span><strong>Pending Sync:</strong> {{ pendingCounts.points }} points / {{ pendingCounts.photos }} photos</span>
      </div>
    </header>

    <main class="app-main">
      <section class="map-section">
        <MapCanvas
          :map-blob="activeMap?.blob ?? null"
          :calibration="activeMap?.calibration ?? null"
          :current-position="currentPosition"
          :selected-photo-location="photoLocationMode === 'map' ? selectedPhotoLocation : null"
          :points="mapPoints"
          :photos="mapPhotos"
          @image-click="onMapClick"
          @photo-marker-click="openPhotoDialog"
        />
      </section>

      <aside class="control-section">
        <MapManagerPanel
          :maps="maps"
          :active-map-id="activeMapId"
          :online="online"
          @select-map="selectMap"
          @save-map-file="saveMapFromFile"
          @download-map-url="saveMapFromUrl"
        />

        <CalibrationPanel
          :last-image-click="lastImageClick"
          :saved-calibration="activeMap?.calibration ?? null"
          :disabled="!activeMap"
          @save="saveCalibration"
        />

        <TrackingControls :tracking="tracking" :can-start="canStartTracking" @start="startTracking" @stop="stopTracking" />

        <PhotoCapturePanel
          :disabled="!canCapturePhoto"
          :disabled-reason="captureDisabledReason"
          :mode="photoLocationMode"
          :can-use-map-selection="canUseMapPhotoSelection"
          :selected-map-location="photoLocationMode === 'map' ? selectedPhotoLocation : null"
          @update:mode="setPhotoLocationMode"
          @capture="capturePhotos"
        />

        <section class="panel sync-panel">
          <h2>Sync Queue</h2>
          <div class="sync-actions">
            <button type="button" @click="syncNow" :disabled="syncing || !online">{{ syncing ? "Syncing..." : "Sync Now" }}</button>
            <span>{{ syncSummary }}</span>
          </div>
          <p class="sync-state" v-if="statusMessage">{{ statusMessage }}</p>
        </section>
      </aside>
    </main>

    <Teleport to="body">
      <div v-if="photoDialogVisible" class="photo-dialog-backdrop" @click.self="closePhotoDialog">
        <section class="photo-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-dialog-title">
          <div class="photo-dialog-header">
            <h2 id="photo-dialog-title">Marker Photos ({{ photoDialogItems.length }})</h2>
            <button
              type="button"
              class="photo-dialog-close"
              @click="closePhotoDialog"
              aria-label="Close marker photos dialog"
            >
              Close
            </button>
          </div>

          <div v-if="selectedDialogPhoto" class="photo-preview-panel">
            <img
              class="photo-preview-image"
              :src="selectedDialogPhoto.url"
              :alt="`Preview ${selectedDialogPhoto.fileName}`"
            />
            <div class="photo-preview-meta">
              <strong>{{ selectedDialogPhoto.fileName }}</strong>
              <span>{{ formatCapturedAt(selectedDialogPhoto.capturedAt) }}</span>
              <button
                type="button"
                class="photo-delete-button"
                :disabled="deletingPhoto"
                @click="deleteSelectedDialogPhoto"
              >
                {{ deletingPhoto ? "Deleting..." : "Delete Photo" }}
              </button>
            </div>
          </div>

          <div class="photo-thumbnail-grid">
            <button
              v-for="photo in photoDialogItems"
              :key="photo.id"
              type="button"
              class="photo-thumbnail-card"
              :class="{ active: selectedDialogPhoto?.id === photo.id }"
              :aria-label="`Preview ${photo.fileName}`"
              @click="selectDialogPhoto(photo.id)"
            >
              <img :src="photo.url" :alt="`Photo ${photo.fileName}`" loading="lazy" />
              <span class="photo-thumbnail-name">{{ photo.fileName }}</span>
              <span class="photo-thumbnail-time">{{ formatCapturedAt(photo.capturedAt) }}</span>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CalibrationPanel from "./components/CalibrationPanel.vue";
import MapCanvas from "./components/MapCanvas.vue";
import MapManagerPanel from "./components/MapManagerPanel.vue";
import PhotoCapturePanel from "./components/PhotoCapturePanel.vue";
import TrackingControls from "./components/TrackingControls.vue";
import { buildCalibration, imageToGeoPoint } from "./services/calibration";
import { optimizePhotoForStorage } from "./services/photoProcessing";
import {
  completeTrack,
  deletePhoto,
  getPendingCounts,
  listMaps,
  listPhotosByMap,
  listPointsByMap,
  saveMap,
  savePhoto,
  savePoint,
  saveTrack,
  updateMapCalibration
} from "./services/db";
import { startLocationWatch } from "./services/geolocation";
import { fetchMapBlobFromUrl } from "./services/api";
import { syncPendingRecords } from "./services/sync";
import type {
  ControlPoint,
  GeoPoint,
  ImagePoint,
  LivePosition,
  MapRecord,
  PendingCounts,
  PhotoLocationMode,
  PhotoRecord,
  TrackPointRecord,
  TrackRecord
} from "./types";

const ACTIVE_MAP_KEY = "navlight-active-map-id";
const CLIENT_ID_KEY = "navlight-client-id";
const MIN_POINT_INTERVAL_MS = 2500;
const PHOTO_MAX_EDGE_PX = 1280;
const PHOTO_JPEG_QUALITY = 0.75;

type PhotoDialogItem = {
  id: string;
  fileName: string;
  capturedAt: string;
  url: string;
};

const maps = ref<MapRecord[]>([]);
const activeMapId = ref<string | null>(localStorage.getItem(ACTIVE_MAP_KEY));
const mapPoints = ref<TrackPointRecord[]>([]);
const mapPhotos = ref<PhotoRecord[]>([]);
const currentPosition = ref<LivePosition | null>(null);
const tracking = ref(false);
const activeTrackId = ref<string | null>(null);
const lastImageClick = ref<ImagePoint | null>(null);
const photoLocationMode = ref<PhotoLocationMode>("current");
const selectedPhotoLocation = ref<GeoPoint | null>(null);
const online = ref(navigator.onLine);
const pendingCounts = ref<PendingCounts>({ points: 0, photos: 0 });
const syncing = ref(false);
const statusMessage = ref("");
const syncSummary = ref("No sync run yet.");
const photoDialogVisible = ref(false);
const photoDialogItems = ref<PhotoDialogItem[]>([]);
const selectedDialogPhotoId = ref<string | null>(null);
const deletingPhoto = ref(false);

let lastRecordedPointMs = 0;
let stopLocationWatch: (() => void) | null = null;

const activeMap = computed(() => maps.value.find((map) => map.id === activeMapId.value) || null);
const canStartTracking = computed(() => Boolean(activeMap.value) && Boolean(currentPosition.value) && !tracking.value);
const canUseMapPhotoSelection = computed(() => Boolean(activeMap.value?.calibration));
const selectedDialogPhoto = computed(() => {
  const selectedId = selectedDialogPhotoId.value;
  if (!selectedId) {
    return photoDialogItems.value[0] || null;
  }

  return photoDialogItems.value.find((photo) => photo.id === selectedId) || photoDialogItems.value[0] || null;
});

const canCapturePhoto = computed(() => {
  if (!activeMap.value) {
    return false;
  }
  if (photoLocationMode.value === "current") {
    return Boolean(currentPosition.value);
  }
  return Boolean(activeMap.value.calibration && selectedPhotoLocation.value);
});

const captureDisabledReason = computed(() => {
  if (!activeMap.value) {
    return "Select a map first.";
  }
  if (photoLocationMode.value === "current" && !currentPosition.value) {
    return "Wait for GPS location before capturing photos.";
  }
  if (photoLocationMode.value === "map" && !activeMap.value.calibration) {
    return "Calibrate this map before choosing photo locations on the map.";
  }
  if (photoLocationMode.value === "map" && !selectedPhotoLocation.value) {
    return "Tap the map to choose where photos should be saved.";
  }
  return "";
});

const clientId = getOrCreateClientId();

function getOrCreateClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const generated = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

async function refreshMaps(): Promise<void> {
  maps.value = await listMaps();
  if (!activeMapId.value && maps.value.length > 0) {
    activeMapId.value = maps.value[0].id;
    localStorage.setItem(ACTIVE_MAP_KEY, activeMapId.value);
  }
}

async function refreshMapData(): Promise<void> {
  if (!activeMapId.value) {
    mapPoints.value = [];
    mapPhotos.value = [];
    return;
  }

  const [points, photos] = await Promise.all([
    listPointsByMap(activeMapId.value),
    listPhotosByMap(activeMapId.value)
  ]);

  mapPoints.value = points;
  mapPhotos.value = photos;
}

async function refreshPending(): Promise<void> {
  pendingCounts.value = await getPendingCounts();
}

function onMapClick(point: ImagePoint): void {
  lastImageClick.value = point;

  if (photoLocationMode.value !== "map") {
    return;
  }

  if (!activeMap.value?.calibration) {
    statusMessage.value = "Calibrate the map before selecting photo locations.";
    return;
  }

  try {
    const geoPoint = imageToGeoPoint(activeMap.value.calibration, point.x, point.y);
    selectedPhotoLocation.value = {
      lat: geoPoint.lat,
      lng: geoPoint.lng,
      accuracy: 0
    };
    statusMessage.value = "Photo location selected on map.";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Unable to convert map click to location.";
  }
}

function formatCapturedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function releasePhotoDialogUrls(): void {
  selectedDialogPhotoId.value = null;
  photoDialogItems.value.forEach((photo) => {
    URL.revokeObjectURL(photo.url);
  });
  photoDialogItems.value = [];
}

function selectDialogPhoto(photoId: string): void {
  selectedDialogPhotoId.value = photoId;
}

function removePhotoDialogItem(photoId: string): void {
  const index = photoDialogItems.value.findIndex((photo) => photo.id === photoId);
  if (index < 0) {
    return;
  }

  const removed = photoDialogItems.value[index];
  URL.revokeObjectURL(removed.url);
  photoDialogItems.value.splice(index, 1);

  if (selectedDialogPhotoId.value === photoId) {
    const next = photoDialogItems.value[index] || photoDialogItems.value[index - 1] || null;
    selectedDialogPhotoId.value = next?.id || null;
  }

  if (photoDialogItems.value.length === 0) {
    photoDialogVisible.value = false;
  }
}

async function deleteSelectedDialogPhoto(): Promise<void> {
  const selected = selectedDialogPhoto.value;
  if (!selected || deletingPhoto.value) {
    return;
  }

  const confirmed = window.confirm(`Delete photo \"${selected.fileName}\"?`);
  if (!confirmed) {
    return;
  }

  deletingPhoto.value = true;
  try {
    await deletePhoto(selected.id);
    removePhotoDialogItem(selected.id);
    await Promise.all([refreshMapData(), refreshPending()]);
    statusMessage.value = "Photo deleted.";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Failed to delete photo.";
  } finally {
    deletingPhoto.value = false;
  }
}

function closePhotoDialog(): void {
  photoDialogVisible.value = false;
  deletingPhoto.value = false;
  releasePhotoDialogUrls();
}

function openPhotoDialog(photos: PhotoRecord[]): void {
  releasePhotoDialogUrls();

  if (photos.length === 0) {
    photoDialogVisible.value = false;
    return;
  }

  photoDialogItems.value = photos.map((photo) => ({
    id: photo.id,
    fileName: photo.fileName,
    capturedAt: photo.capturedAt,
    url: URL.createObjectURL(photo.blob)
  }));
  selectedDialogPhotoId.value = photoDialogItems.value[0]?.id || null;

  photoDialogVisible.value = true;
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && photoDialogVisible.value) {
    closePhotoDialog();
  }
}

function setPhotoLocationMode(mode: PhotoLocationMode): void {
  photoLocationMode.value = mode;
  if (mode === "current") {
    selectedPhotoLocation.value = null;
    return;
  }

  if (!activeMap.value?.calibration) {
    statusMessage.value = "Calibrate the map before selecting a photo location.";
    return;
  }

  statusMessage.value = "Tap the map to choose photo location.";
}

function selectMap(mapId: string): void {
  activeMapId.value = mapId;
  localStorage.setItem(ACTIVE_MAP_KEY, mapId);
}

async function saveMapFromFile(payload: { name: string; file: File }): Promise<void> {
  const map: MapRecord = {
    id: crypto.randomUUID(),
    name: payload.name,
    blob: payload.file,
    createdAt: new Date().toISOString(),
    calibration: null
  };

  await saveMap(map);
  statusMessage.value = `Saved map: ${map.name}`;
  await refreshMaps();
  activeMapId.value = map.id;
  localStorage.setItem(ACTIVE_MAP_KEY, map.id);
}

async function saveMapFromUrl(payload: { name: string; url: string }): Promise<void> {
  if (!online.value) {
    statusMessage.value = "Cannot download map while offline.";
    return;
  }

  try {
    const blob = await fetchMapBlobFromUrl(payload.url);
    const map: MapRecord = {
      id: crypto.randomUUID(),
      name: payload.name,
      blob,
      createdAt: new Date().toISOString(),
      calibration: null
    };

    await saveMap(map);
    statusMessage.value = `Downloaded map: ${map.name}`;
    await refreshMaps();
    activeMapId.value = map.id;
    localStorage.setItem(ACTIVE_MAP_KEY, map.id);
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Map download failed.";
  }
}

async function saveCalibration(points: [ControlPoint, ControlPoint, ControlPoint]): Promise<void> {
  if (!activeMapId.value) {
    statusMessage.value = "Select a map before calibration.";
    return;
  }

  try {
    const calibration = buildCalibration(points);
    await updateMapCalibration(activeMapId.value, calibration);
    statusMessage.value = "Calibration saved.";
    await refreshMaps();
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Calibration failed.";
  }
}

async function startTracking(): Promise<void> {
  if (!activeMapId.value || !currentPosition.value) {
    statusMessage.value = "Map and GPS location are required to start tracking.";
    return;
  }

  const track: TrackRecord = {
    id: crypto.randomUUID(),
    mapId: activeMapId.value,
    startedAt: new Date().toISOString(),
    endedAt: null,
    syncStatus: "pending"
  };

  await saveTrack(track);
  activeTrackId.value = track.id;
  tracking.value = true;
  statusMessage.value = "Tracking started.";
}

async function stopTracking(): Promise<void> {
  if (!activeTrackId.value) {
    return;
  }

  await completeTrack(activeTrackId.value, new Date().toISOString());
  tracking.value = false;
  activeTrackId.value = null;
  statusMessage.value = "Tracking stopped.";
}

async function capturePhotos(files: File[]): Promise<void> {
  if (!activeMapId.value) {
    statusMessage.value = "Map is required before adding photos.";
    return;
  }

  let location: GeoPoint | null = null;
  if (photoLocationMode.value === "current") {
    if (!currentPosition.value) {
      statusMessage.value = "Current GPS location is not available.";
      return;
    }

    location = {
      lat: currentPosition.value.lat,
      lng: currentPosition.value.lng,
      accuracy: currentPosition.value.accuracy
    };
  } else {
    if (!selectedPhotoLocation.value) {
      statusMessage.value = "Tap the map to choose photo location before capturing.";
      return;
    }
    location = selectedPhotoLocation.value;
  }

  let optimizedCount = 0;

  for (const file of files) {
    const prepared = await optimizePhotoForStorage(file, {
      maxEdgePx: PHOTO_MAX_EDGE_PX,
      jpegQuality: PHOTO_JPEG_QUALITY
    });

    if (prepared.optimized) {
      optimizedCount += 1;
    }

    const photo: PhotoRecord = {
      id: crypto.randomUUID(),
      trackId: activeTrackId.value,
      mapId: activeMapId.value,
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      capturedAt: new Date().toISOString(),
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      blob: prepared.blob,
      syncStatus: "pending",
      lastError: null
    };

    await savePhoto(photo);
  }

  const modeText = photoLocationMode.value === "current" ? "current GPS" : "selected map location";
  const optimizeText =
    optimizedCount > 0 ? ` ${optimizedCount} photo(s) were resized/compressed for upload.` : "";
  statusMessage.value = `${files.length} photo(s) saved offline at ${modeText}.${optimizeText}`;
  await refreshMapData();
  await refreshPending();
}

async function syncNow(): Promise<void> {
  if (!online.value) {
    statusMessage.value = "Sync is only available while online.";
    return;
  }

  syncing.value = true;
  statusMessage.value = "Sync in progress...";

  try {
    const result = await syncPendingRecords(clientId);
    syncSummary.value = `Synced ${result.syncedPoints} point(s), ${result.syncedPhotos} photo(s).`;
    if (result.failedPhotos > 0) {
      syncSummary.value += ` ${result.failedPhotos} photo(s) failed.`;
    }
    statusMessage.value = "Sync finished.";
    await Promise.all([refreshMapData(), refreshPending()]);
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Sync failed.";
  } finally {
    syncing.value = false;
  }
}

async function handlePositionUpdate(position: LivePosition): Promise<void> {
  currentPosition.value = position;

  if (!tracking.value || !activeTrackId.value || !activeMapId.value) {
    return;
  }

  const now = Date.now();
  if (now - lastRecordedPointMs < MIN_POINT_INTERVAL_MS) {
    return;
  }

  lastRecordedPointMs = now;

  const point: TrackPointRecord = {
    id: crypto.randomUUID(),
    trackId: activeTrackId.value,
    mapId: activeMapId.value,
    lat: position.lat,
    lng: position.lng,
    accuracy: position.accuracy,
    recordedAt: new Date(position.timestamp).toISOString(),
    syncStatus: "pending"
  };

  await savePoint(point);
  mapPoints.value.push(point);
  await refreshPending();
}

function handleLocationError(message: string): void {
  statusMessage.value = message;
}

function setOnlineState(value: boolean): void {
  online.value = value;
}

function handleOnline(): void {
  setOnlineState(true);
}

function handleOffline(): void {
  setOnlineState(false);
}

watch(activeMapId, () => {
  closePhotoDialog();
  selectedPhotoLocation.value = null;
  refreshMapData().catch((error) => {
    statusMessage.value = error instanceof Error ? error.message : "Failed to load map data.";
  });
});

onMounted(async () => {
  await refreshMaps();
  await Promise.all([refreshMapData(), refreshPending()]);

  stopLocationWatch = startLocationWatch(
    (position) => {
      handlePositionUpdate(position).catch((error) => {
        statusMessage.value = error instanceof Error ? error.message : "Failed to save GPS point.";
      });
    },
    handleLocationError
  );

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("keydown", handleWindowKeydown);
});

onBeforeUnmount(() => {
  closePhotoDialog();
  if (stopLocationWatch) {
    stopLocationWatch();
  }
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

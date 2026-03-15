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
          :routes="serverRoutes"
          :route-draft-points="routeDraftPoints"
          :route-draft-color="routeColor"
          @image-click="onMapClick"
          @photo-marker-click="openPhotoDialog"
        />
      </section>

      <aside class="control-section">
        <MapManagerPanel
          :server-maps="serverMaps"
          :active-map-id="activeMapId"
          :offline-map-name="activeMap?.name ?? null"
          :creating-new-map="creatingNewMap"
          :online="online"
          @start-create-map="startCreateNewMap"
          @select-map="selectMap"
          @save-map-file="saveMapFromFile"
          @download-map-url="saveMapFromUrl"
        />

        <CalibrationPanel
          v-if="creatingNewMap"
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

        <section class="panel route-panel">
          <h2>Create Route</h2>
          <p class="route-help">Name a route, choose a color, then tap map points to draw connected lines.</p>

          <p class="sync-state" v-if="!online">Route creation is only available while online.</p>
          <p class="sync-state" v-else-if="!activeMapId">Select a map to create routes.</p>
          <p class="sync-state" v-else-if="isDraftActiveMap">Save map calibration before creating routes.</p>
          <p class="sync-state" v-else-if="!activeMap?.calibration">Calibrate this map before creating routes.</p>

          <template v-else>
            <label class="route-label">
              Route Name
              <input v-model="routeName" type="text" maxlength="120" placeholder="Leg 1" :disabled="!routeCreateEnabled" />
            </label>

            <label class="route-label color">
              Route Color
              <input v-model="routeColor" type="color" :disabled="!routeCreateEnabled" />
            </label>

            <div class="route-actions" v-if="!routeCreateEnabled">
              <button type="button" @click="startRouteSelection">Start Route</button>
            </div>

            <div class="route-actions" v-else>
              <button type="button" class="secondary" @click="clearRoutePoints" :disabled="routeDraftPoints.length === 0">
                Clear Points
              </button>
              <button type="button" class="secondary" @click="cancelRouteSelection">Cancel</button>
              <button type="button" @click="saveRoute" :disabled="!canSaveRoute || savingRoute">
                {{ savingRoute ? "Saving..." : "Save Route" }}
              </button>
            </div>

            <p class="sync-state" v-if="routeCreateEnabled">
              Tap the map to add route points. Points selected: {{ routeDraftPoints.length }}
            </p>

            <ul class="route-list" v-if="serverRoutes.length > 0">
              <li v-for="route in serverRoutes" :key="route.id">
                <span class="route-color-dot" :style="{ backgroundColor: route.color }"></span>
                <span>{{ route.name }}</span>
                <small>{{ route.points.length }} pts</small>
                <button
                  type="button"
                  class="route-delete"
                  :disabled="!online || deletingRouteId === route.id"
                  @click="removeRoute(route)"
                >
                  {{ deletingRouteId === route.id ? "Removing..." : "Remove" }}
                </button>
              </li>
            </ul>
          </template>
        </section>

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
  clearLocalMapSessionData,
  completeTrack,
  deletePhoto,
  getPendingCounts,
  listMaps,
  listPhotosByMap,
  listPointsByMap,
  replacePhotosForMap,
  saveMap,
  savePhoto,
  savePoint,
  saveTrack,
  updateMapCalibration
} from "./services/db";
import { startLocationWatch } from "./services/geolocation";
import {
  deleteMapRouteFromServer,
  fetchMapBlobFromUrl,
  fetchServerMapImage,
  fetchServerMapPhotoBlob,
  listServerMapRoutes,
  listServerMaps,
  listServerMapPhotos,
  saveMapRouteToServer,
  saveMapCalibrationToServer,
  saveMapToServer
} from "./services/api";
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
  RoutePoint,
  ServerMapSummary,
  ServerRoute,
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

const offlineMaps = ref<MapRecord[]>([]);
const serverMaps = ref<ServerMapSummary[]>([]);
const draftMap = ref<MapRecord | null>(null);
const creatingNewMap = ref(false);
const activeMapId = ref<string | null>(localStorage.getItem(ACTIVE_MAP_KEY));
const mapPoints = ref<TrackPointRecord[]>([]);
const mapPhotos = ref<PhotoRecord[]>([]);
const serverRoutes = ref<ServerRoute[]>([]);
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
const routeName = ref("");
const routeColor = ref("#ff7f11");
const routeDraftPoints = ref<RoutePoint[]>([]);
const routeCreateEnabled = ref(false);
const savingRoute = ref(false);
const deletingRouteId = ref<string | null>(null);

let lastRecordedPointMs = 0;
let stopLocationWatch: (() => void) | null = null;

const activeMap = computed(() => {
  if (draftMap.value && activeMapId.value === draftMap.value.id) {
    return draftMap.value;
  }

  return offlineMaps.value.find((map) => map.id === activeMapId.value) || null;
});
const isDraftActiveMap = computed(() => Boolean(draftMap.value && activeMapId.value === draftMap.value.id));
const canStartTracking = computed(
  () => Boolean(activeMap.value) && !isDraftActiveMap.value && Boolean(currentPosition.value) && !tracking.value
);
const canUseMapPhotoSelection = computed(() => Boolean(activeMap.value?.calibration) && !isDraftActiveMap.value);
const canCreateRouteOnCurrentMap = computed(
  () => Boolean(online.value && activeMapId.value && activeMap.value?.calibration && !isDraftActiveMap.value)
);
const canSaveRoute = computed(
  () =>
    Boolean(
      canCreateRouteOnCurrentMap.value &&
        routeCreateEnabled.value &&
        routeName.value.trim().length > 0 &&
        routeDraftPoints.value.length >= 2
    )
);
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
  if (isDraftActiveMap.value) {
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
  if (isDraftActiveMap.value) {
    return "Save calibration to persist this map before tracking or photo capture.";
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

function setActiveMapId(mapId: string | null): void {
  activeMapId.value = mapId;
  if (mapId) {
    localStorage.setItem(ACTIVE_MAP_KEY, mapId);
    return;
  }

  localStorage.removeItem(ACTIVE_MAP_KEY);
}

function setDraftMap(map: MapRecord): void {
  draftMap.value = map;
  setActiveMapId(map.id);
}

function clearDraftMap(): void {
  draftMap.value = null;
}

function confirmLocalDataResetForNewMap(): boolean {
  return window.confirm(
    "Loading a new map will clear local browser data (offline map, calibration, tracks, points, and photos). Server data will not be deleted. Continue?"
  );
}

async function clearLocalBrowserDataForNewMap(): Promise<void> {
  closePhotoDialog();
  clearDraftMap();

  tracking.value = false;
  activeTrackId.value = null;
  lastRecordedPointMs = 0;
  selectedPhotoLocation.value = null;
  lastImageClick.value = null;

  await clearLocalMapSessionData();

  mapPoints.value = [];
  mapPhotos.value = [];
  await Promise.all([refreshOfflineMaps(), refreshPending()]);
}

async function refreshOfflineMaps(): Promise<void> {
  offlineMaps.value = await listMaps();

  if (offlineMaps.value.length === 0) {
    if (draftMap.value) {
      setActiveMapId(draftMap.value.id);
      return;
    }

    setActiveMapId(null);
    return;
  }

  const hasActiveMap = activeMapId.value
    ? offlineMaps.value.some((map) => map.id === activeMapId.value) ||
      (draftMap.value !== null && draftMap.value.id === activeMapId.value)
    : false;

  if (!hasActiveMap) {
    setActiveMapId(offlineMaps.value[0].id);
  }
}

async function refreshServerMaps(): Promise<void> {
  if (!online.value) {
    return;
  }

  serverMaps.value = await listServerMaps();
}

function getServerMapSummary(mapId: string): ServerMapSummary | null {
  return serverMaps.value.find((map) => map.id === mapId) || null;
}

function resetRouteDraft(clearName = false): void {
  routeCreateEnabled.value = false;
  routeDraftPoints.value = [];
  savingRoute.value = false;
  if (clearName) {
    routeName.value = "";
  }
}

async function refreshServerRoutesForActiveMap(): Promise<void> {
  if (!online.value || !activeMapId.value || isDraftActiveMap.value) {
    serverRoutes.value = [];
    return;
  }

  serverRoutes.value = await listServerMapRoutes(activeMapId.value);
}

function startRouteSelection(): void {
  if (!canCreateRouteOnCurrentMap.value) {
    statusMessage.value = "Routes can only be created online on a saved calibrated map.";
    return;
  }

  routeCreateEnabled.value = true;
  routeDraftPoints.value = [];
  statusMessage.value = "Route creation started. Tap the map to add route points.";
}

function cancelRouteSelection(): void {
  if (!routeCreateEnabled.value) {
    return;
  }

  resetRouteDraft(false);
  statusMessage.value = "Route creation canceled.";
}

function clearRoutePoints(): void {
  routeDraftPoints.value = [];
  statusMessage.value = "Route points cleared.";
}

async function saveRoute(): Promise<void> {
  if (!activeMapId.value) {
    statusMessage.value = "Select a map before saving a route.";
    return;
  }

  if (!canSaveRoute.value) {
    statusMessage.value = "Route name and at least two route points are required.";
    return;
  }

  savingRoute.value = true;
  try {
    await saveMapRouteToServer(activeMapId.value, {
      name: routeName.value.trim(),
      color: routeColor.value,
      points: routeDraftPoints.value.map((point) => ({ lat: point.lat, lng: point.lng }))
    });

    await refreshServerRoutesForActiveMap();
    resetRouteDraft(true);
    statusMessage.value = "Route saved to server.";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Failed to save route.";
  } finally {
    savingRoute.value = false;
  }
}

async function removeRoute(route: ServerRoute): Promise<void> {
  if (!online.value || !activeMapId.value) {
    statusMessage.value = "Route removal is only available while online.";
    return;
  }

  const confirmed = window.confirm(`Delete route "${route.name}"?`);
  if (!confirmed) {
    return;
  }

  deletingRouteId.value = route.id;
  try {
    await deleteMapRouteFromServer(activeMapId.value, route.id);
    await refreshServerRoutesForActiveMap();
    statusMessage.value = "Route deleted.";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Failed to delete route.";
  } finally {
    deletingRouteId.value = null;
  }
}

async function cacheMapOffline(mapSummary: ServerMapSummary, blob: Blob): Promise<void> {
  clearDraftMap();

  const offlineMap: MapRecord = {
    id: mapSummary.id,
    name: mapSummary.name,
    blob,
    createdAt: mapSummary.createdAt || new Date().toISOString(),
    calibration: mapSummary.calibration
  };

  await saveMap(offlineMap);
  await refreshOfflineMaps();
  setActiveMapId(offlineMap.id);
}

async function downloadServerMapPhotos(mapId: string): Promise<PhotoRecord[]> {
  const serverPhotos = await listServerMapPhotos(mapId);
  const downloaded: PhotoRecord[] = [];

  for (const serverPhoto of serverPhotos) {
    const blob = await fetchServerMapPhotoBlob(serverPhoto.fileUrl);
    downloaded.push({
      id: serverPhoto.id,
      trackId: serverPhoto.trackId,
      mapId: serverPhoto.mapId,
      lat: serverPhoto.lat,
      lng: serverPhoto.lng,
      accuracy: serverPhoto.accuracy,
      capturedAt: serverPhoto.capturedAt,
      fileName: serverPhoto.fileName,
      mimeType: serverPhoto.mimeType,
      blob,
      syncStatus: "synced",
      lastError: null
    });
  }

  return downloaded;
}

async function loadServerMapAsOffline(mapId: string): Promise<number> {
  const mapSummary = getServerMapSummary(mapId);
  if (!mapSummary) {
    throw new Error("Map not found in server list.");
  }

  const [blob, downloadedPhotos] = await Promise.all([
    fetchServerMapImage(mapId),
    downloadServerMapPhotos(mapId)
  ]);

  await cacheMapOffline(mapSummary, blob);
  await replacePhotosForMap(mapId, downloadedPhotos);
  await Promise.all([refreshMapData(), refreshPending()]);

  return downloadedPhotos.length;
}

async function syncActiveCalibrationIfNeeded(): Promise<void> {
  if (isDraftActiveMap.value) {
    return;
  }

  const map = activeMap.value;
  if (!online.value || !map?.calibration) {
    return;
  }

  if (!getServerMapSummary(map.id)) {
    return;
  }

  await saveMapCalibrationToServer(map.id, map.calibration);
  await refreshServerMaps();
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

  if (routeCreateEnabled.value) {
    if (!online.value) {
      statusMessage.value = "Go online to continue route creation.";
      return;
    }

    if (!activeMap.value?.calibration) {
      statusMessage.value = "Calibrate the map before selecting route points.";
      return;
    }

    try {
      const geoPoint = imageToGeoPoint(activeMap.value.calibration, point.x, point.y);
      routeDraftPoints.value.push({
        lat: geoPoint.lat,
        lng: geoPoint.lng
      });
      statusMessage.value = `Route point ${routeDraftPoints.value.length} added.`;
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : "Unable to add route point.";
    }
    return;
  }

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

function startCreateNewMap(): void {
  if (!online.value) {
    statusMessage.value = "Go online to create a new map.";
    return;
  }

  resetRouteDraft(true);
  serverRoutes.value = [];
  creatingNewMap.value = true;
  closePhotoDialog();
  clearDraftMap();
  setActiveMapId(null);
  mapPoints.value = [];
  mapPhotos.value = [];
  selectedPhotoLocation.value = null;
  lastImageClick.value = null;
  tracking.value = false;
  activeTrackId.value = null;
  lastRecordedPointMs = 0;
  statusMessage.value = "Create new map selected. Enter map name, load map file or URL, then calibrate and save.";
}

async function selectMap(mapId: string): Promise<void> {
  if (!online.value) {
    statusMessage.value = "Go online to load a map from the server list.";
    return;
  }

  try {
    resetRouteDraft(true);
    creatingNewMap.value = false;
    if (!getServerMapSummary(mapId)) {
      await refreshServerMaps();
    }
    clearDraftMap();
    const downloadedPhotoCount = await loadServerMapAsOffline(mapId);
    const selected = getServerMapSummary(mapId);
    statusMessage.value = selected
      ? `Loaded offline map: ${selected.name}. Downloaded ${downloadedPhotoCount} photo(s) from server.`
      : `Loaded selected map for offline use. Downloaded ${downloadedPhotoCount} photo(s) from server.`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Failed to load selected map.";
  }
}

async function saveMapFromFile(payload: { name: string; file: File }): Promise<void> {
  if (!online.value) {
    statusMessage.value = "Go online to load and save maps.";
    return;
  }

  if (!creatingNewMap.value) {
    statusMessage.value = "Choose Create new map before loading a new map file.";
    return;
  }

  if (!confirmLocalDataResetForNewMap()) {
    statusMessage.value = "Map load canceled.";
    return;
  }

  try {
    await clearLocalBrowserDataForNewMap();

    const draft: MapRecord = {
      id: crypto.randomUUID(),
      name: payload.name,
      blob: payload.file,
      createdAt: new Date().toISOString(),
      calibration: null
    };

    setDraftMap(draft);
    creatingNewMap.value = true;
    statusMessage.value = `Map loaded for calibration: ${draft.name}. Local tracks/photos/calibration were cleared.`;
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Map save failed.";
  }
}

async function saveMapFromUrl(payload: { name: string; url: string }): Promise<void> {
  if (!online.value) {
    statusMessage.value = "Go online to download and save maps.";
    return;
  }

  if (!creatingNewMap.value) {
    statusMessage.value = "Choose Create new map before downloading a new map.";
    return;
  }

  if (!confirmLocalDataResetForNewMap()) {
    statusMessage.value = "Map download canceled.";
    return;
  }

  try {
    const blob = await fetchMapBlobFromUrl(payload.url);
    await clearLocalBrowserDataForNewMap();

    const draft: MapRecord = {
      id: crypto.randomUUID(),
      name: payload.name,
      blob,
      createdAt: new Date().toISOString(),
      calibration: null
    };

    setDraftMap(draft);
    creatingNewMap.value = true;
    statusMessage.value = `Map downloaded for calibration: ${draft.name}. Local tracks/photos/calibration were cleared.`;
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

    if (isDraftActiveMap.value && draftMap.value) {
      draftMap.value = {
        ...draftMap.value,
        calibration
      };

      if (!online.value) {
        statusMessage.value = "Go online and save calibration to persist this map.";
        return;
      }

      const saved = await saveMapToServer({
        mapId: draftMap.value.id,
        name: draftMap.value.name,
        mapBlob: draftMap.value.blob,
        fileName: `${draftMap.value.name}.jpg`,
        calibration
      });

      await cacheMapOffline(saved, draftMap.value.blob);
      await refreshServerMaps();
      await refreshServerRoutesForActiveMap();
      creatingNewMap.value = false;
      statusMessage.value = "Map and calibration saved to server and offline cache.";
      return;
    }

    await updateMapCalibration(activeMapId.value, calibration);

    if (online.value) {
      await saveMapCalibrationToServer(activeMapId.value, calibration);
      await refreshServerMaps();
      statusMessage.value = "Calibration saved locally and on server.";
    } else {
      statusMessage.value = "Calibration saved offline. Go online and save again to update server.";
    }

    await refreshOfflineMaps();
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "Calibration failed.";
  }
}

async function startTracking(): Promise<void> {
  if (!activeMapId.value || !currentPosition.value) {
    statusMessage.value = "Map and GPS location are required to start tracking.";
    return;
  }

  if (isDraftActiveMap.value) {
    statusMessage.value = "Save calibration to persist this map before tracking.";
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

  if (isDraftActiveMap.value) {
    statusMessage.value = "Save calibration to persist this map before capturing photos.";
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
    const result = await syncPendingRecords(clientId, activeMapId.value);
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
  refreshServerMaps()
    .then(() => Promise.all([syncActiveCalibrationIfNeeded(), refreshServerRoutesForActiveMap()]))
    .catch((error) => {
      statusMessage.value = error instanceof Error ? error.message : "Failed to refresh server maps.";
    });
}

function handleOffline(): void {
  setOnlineState(false);
  resetRouteDraft(false);
  serverRoutes.value = [];
}

watch(activeMapId, () => {
  resetRouteDraft(true);
  closePhotoDialog();
  selectedPhotoLocation.value = null;
  refreshMapData().catch((error) => {
    statusMessage.value = error instanceof Error ? error.message : "Failed to load map data.";
  });

  if (!online.value) {
    serverRoutes.value = [];
    return;
  }

  refreshServerRoutesForActiveMap().catch((error) => {
    statusMessage.value = error instanceof Error ? error.message : "Failed to load routes for selected map.";
  });
});

onMounted(async () => {
  await refreshOfflineMaps();
  if (online.value) {
    await Promise.all([refreshServerMaps(), refreshServerRoutesForActiveMap()]);
  }
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

<style scoped>
.route-panel {
  display: grid;
  gap: 0.55rem;
}

.route-panel h2 {
  margin: 0;
  font-size: 1rem;
}

.route-help {
  margin: 0;
  color: #4d6575;
  font-size: 0.9rem;
}

.route-label {
  display: grid;
  gap: 0.25rem;
  color: #334b59;
  font-size: 0.87rem;
}

.route-label input[type="text"] {
  border-radius: 8px;
  border: 1px solid #bac8d1;
  padding: 0.5rem 0.6rem;
}

.route-label.color {
  max-width: 10rem;
}

.route-label input[type="color"] {
  border-radius: 8px;
  border: 1px solid #bac8d1;
  width: 3rem;
  height: 2rem;
  padding: 0.15rem;
  background: #ffffff;
}

.route-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.route-actions button {
  border: none;
  border-radius: 8px;
  background: #124559;
  color: #ffffff;
  padding: 0.5rem 0.8rem;
  font-weight: 700;
}

.route-actions button.secondary {
  background: #4b6575;
}

.route-actions button:disabled {
  opacity: 0.55;
}

.route-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.3rem;
}

.route-list li {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: #334b59;
}

.route-color-dot {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

.route-list small {
  color: #6e8390;
  font-size: 0.76rem;
}

.route-delete {
  border: none;
  border-radius: 7px;
  background: #b63a2d;
  color: #ffffff;
  padding: 0.32rem 0.62rem;
  font-size: 0.75rem;
  font-weight: 700;
}

.route-delete:disabled {
  opacity: 0.55;
}
</style>

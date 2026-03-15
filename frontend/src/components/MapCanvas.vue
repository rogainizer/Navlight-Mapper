<template>
  <div ref="containerRef" class="map-canvas-shell">
    <div class="map-canvas-wrap">
      <canvas
        ref="canvasRef"
        :class="[
          'map-canvas',
          {
            pannable: canPan,
            dragging: isDragging,
            selectable: interactionMode === 'select'
          }
        ]"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      ></canvas>

      <div v-if="mapBlob" class="interaction-controls">
        <button
          type="button"
          class="mode-button"
          :class="{ active: interactionMode === 'select' }"
          @click="setInteractionMode('select')"
          aria-label="Select mode"
        >
          Select
        </button>
        <button
          type="button"
          class="mode-button"
          :class="{ active: interactionMode === 'pan' }"
          :disabled="zoomLevel <= 1"
          @click="setInteractionMode('pan')"
          aria-label="Pan mode"
        >
          Pan
        </button>
      </div>

      <div v-if="mapBlob" class="zoom-controls">
        <button
          type="button"
          class="zoom-button"
          :disabled="zoomLevel <= MIN_ZOOM"
          @click="zoomOut"
          aria-label="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          class="zoom-button zoom-level"
          :disabled="zoomLevel === 1"
          @click="resetZoom"
          aria-label="Reset zoom"
        >
          {{ zoomPercent }}%
        </button>
        <button
          type="button"
          class="zoom-button"
          :disabled="zoomLevel >= MAX_ZOOM"
          @click="zoomIn"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </div>

    <p class="map-caption">{{ caption }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { geoToImagePoint } from "../services/calibration";
import type {
  CalibrationModel,
  GeoPoint,
  ImagePoint,
  LivePosition,
  PhotoRecord,
  TrackPointRecord
} from "../types";

const props = defineProps<{
  mapBlob: Blob | null;
  calibration: CalibrationModel | null;
  currentPosition: LivePosition | null;
  selectedPhotoLocation: GeoPoint | null;
  points: TrackPointRecord[];
  photos: PhotoRecord[];
}>();

const emit = defineEmits<{
  (event: "image-click", point: ImagePoint): void;
  (event: "photo-marker-click", photos: PhotoRecord[]): void;
}>();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const PHOTO_MARKER_RADIUS = 12;
const PHOTO_MARKER_HIT_PADDING = 4;
type InteractionMode = "select" | "pan";

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const loadedImage = ref<HTMLImageElement | null>(null);
const currentObjectUrl = ref<string | null>(null);
const zoomLevel = ref(1);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
const interactionMode = ref<InteractionMode>("select");

const dragState = {
  active: false,
  pointerId: -1,
  startClientX: 0,
  startClientY: 0,
  startPanX: 0,
  startPanY: 0
};

const drawState = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  panLimitX: 0,
  panLimitY: 0,
  width: 0,
  height: 0
};

const zoomPercent = computed(() => Math.round(zoomLevel.value * 100));
const canPan = computed(
  () => interactionMode.value === "pan" && zoomLevel.value > 1.01 && Boolean(loadedImage.value)
);

const caption = computed(() => {
  if (!props.mapBlob) {
    return "Add a JPEG map to begin.";
  }
  if (!props.calibration) {
    return "Tap the map and complete 3-point calibration to overlay GPS data.";
  }
  if (interactionMode.value === "pan") {
    return "Pan mode: drag the map. Switch to Select mode to pick calibration/photo points.";
  }
  return "Select mode: tap map for calibration/photo location. Zoom in and switch to Pan mode to drag.";
});

function releaseObjectUrl(): void {
  if (currentObjectUrl.value) {
    URL.revokeObjectURL(currentObjectUrl.value);
    currentObjectUrl.value = null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPanToLimits(): void {
  if (drawState.panLimitX <= 0) {
    panX.value = 0;
  } else {
    panX.value = clamp(panX.value, -drawState.panLimitX, drawState.panLimitX);
  }

  if (drawState.panLimitY <= 0) {
    panY.value = 0;
  } else {
    panY.value = clamp(panY.value, -drawState.panLimitY, drawState.panLimitY);
  }
}

function setZoom(value: number): void {
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
  zoomLevel.value = clamped;

  if (zoomLevel.value <= 1) {
    panX.value = 0;
    panY.value = 0;
    if (interactionMode.value === "pan") {
      interactionMode.value = "select";
    }
  }

  drawOverlay();
}

function zoomIn(): void {
  setZoom(zoomLevel.value + ZOOM_STEP);
}

function zoomOut(): void {
  setZoom(zoomLevel.value - ZOOM_STEP);
}

function resetZoom(): void {
  panX.value = 0;
  panY.value = 0;
  setZoom(1);
}

function setInteractionMode(mode: InteractionMode): void {
  if (mode === "pan" && zoomLevel.value <= 1) {
    return;
  }

  interactionMode.value = mode;
  if (mode === "select") {
    finishDrag();
  }
}

function toCanvasPoint(lat: number, lng: number): ImagePoint | null {
  if (!props.calibration) {
    return null;
  }

  const imagePoint = geoToImagePoint(props.calibration as CalibrationModel, lat, lng);
  const x = drawState.offsetX + imagePoint.x * drawState.scaleX;
  const y = drawState.offsetY + imagePoint.y * drawState.scaleY;

  if (Number.isNaN(x) || Number.isNaN(y)) {
    return null;
  }

  return { x, y };
}

function getCanvasPointFromPointer(event: PointerEvent): ImagePoint | null {
  if (!canvasRef.value) {
    return null;
  }

  const rect = canvasRef.value.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;

  if (canvasX < 0 || canvasY < 0 || canvasX > rect.width || canvasY > rect.height) {
    return null;
  }

  return { x: canvasX, y: canvasY };
}

function canvasPointToImagePoint(canvasPoint: ImagePoint): ImagePoint | null {
  if (!loadedImage.value) {
    return null;
  }

  const canvasX = canvasPoint.x;
  const canvasY = canvasPoint.y;
  const imageX = (canvasX - drawState.offsetX) / drawState.scaleX;
  const imageY = (canvasY - drawState.offsetY) / drawState.scaleY;

  if (
    imageX < 0 ||
    imageY < 0 ||
    imageX > loadedImage.value.naturalWidth ||
    imageY > loadedImage.value.naturalHeight
  ) {
    return null;
  }

  return { x: imageX, y: imageY };
}

function getPhotosNearCanvasPoint(canvasPoint: ImagePoint): PhotoRecord[] {
  if (!props.calibration || props.photos.length === 0) {
    return [];
  }

  const hitRadius = PHOTO_MARKER_RADIUS + PHOTO_MARKER_HIT_PADDING;
  const hitRadiusSq = hitRadius * hitRadius;

  return props.photos.filter((photo) => {
    const point = toCanvasPoint(photo.lat, photo.lng);
    if (!point) {
      return false;
    }

    const dx = canvasPoint.x - point.x;
    const dy = canvasPoint.y - point.y;
    return dx * dx + dy * dy <= hitRadiusSq;
  });
}

function finishDrag(): void {
  const canvas = canvasRef.value;
  if (canvas && dragState.pointerId >= 0 && canvas.hasPointerCapture(dragState.pointerId)) {
    canvas.releasePointerCapture(dragState.pointerId);
  }

  dragState.active = false;
  dragState.pointerId = -1;
  isDragging.value = false;
}

function drawOverlay(): void {
  const canvas = canvasRef.value;
  const image = loadedImage.value;
  if (!canvas || !image) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const containerWidth = containerRef.value?.clientWidth || 640;
  const imageAspectRatio = image.naturalHeight / image.naturalWidth;
  const renderWidth = Math.max(320, containerWidth);
  const renderHeight = Math.max(220, renderWidth * imageAspectRatio);

  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(renderWidth * pixelRatio);
  canvas.height = Math.round(renderHeight * pixelRatio);
  canvas.style.width = `${renderWidth}px`;
  canvas.style.height = `${renderHeight}px`;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, renderWidth, renderHeight);

  const drawWidth = renderWidth * zoomLevel.value;
  const drawHeight = renderHeight * zoomLevel.value;
  const baseOffsetX = (renderWidth - drawWidth) / 2;
  const baseOffsetY = (renderHeight - drawHeight) / 2;

  drawState.panLimitX = Math.max(0, (drawWidth - renderWidth) / 2);
  drawState.panLimitY = Math.max(0, (drawHeight - renderHeight) / 2);
  clampPanToLimits();

  const offsetX = baseOffsetX + panX.value;
  const offsetY = baseOffsetY + panY.value;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  drawState.width = renderWidth;
  drawState.height = renderHeight;
  drawState.offsetX = offsetX;
  drawState.offsetY = offsetY;
  drawState.scaleX = drawWidth / image.naturalWidth;
  drawState.scaleY = drawHeight / image.naturalHeight;

  if (!props.calibration) {
    context.fillStyle = "rgba(0, 0, 0, 0.65)";
    context.fillRect(12, 12, 280, 30);
    context.fillStyle = "#ffffff";
    context.font = "14px sans-serif";
    context.fillText("Calibrate this map to show GPS overlays", 20, 32);
    return;
  }

  const pointCoordinates = props.points
    .map((point) => toCanvasPoint(point.lat, point.lng))
    .filter((point): point is ImagePoint => point !== null);

  if (pointCoordinates.length > 1) {
    context.strokeStyle = "#2a9d8f";
    context.lineWidth = 3;
    context.beginPath();
    pointCoordinates.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();
  }

  context.fillStyle = "#ef476f";
  props.photos.forEach((photo) => {
    const point = toCanvasPoint(photo.lat, photo.lng);
    if (!point) {
      return;
    }
    context.beginPath();
    context.arc(point.x, point.y, PHOTO_MARKER_RADIUS, 0, Math.PI * 2);
    context.fill();
  });

  if (props.currentPosition) {
    const currentPoint = toCanvasPoint(props.currentPosition.lat, props.currentPosition.lng);
    if (currentPoint) {
      context.fillStyle = "#118ab2";
      context.beginPath();
      context.arc(currentPoint.x, currentPoint.y, 8, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = "rgba(17, 138, 178, 0.35)";
      context.lineWidth = 2;
      context.beginPath();
      const uncertaintyRadius = Math.max(12, Math.min(60, props.currentPosition.accuracy * 0.8));
      context.arc(currentPoint.x, currentPoint.y, uncertaintyRadius, 0, Math.PI * 2);
      context.stroke();
    }
  }

  if (props.selectedPhotoLocation) {
    const selectedPoint = toCanvasPoint(props.selectedPhotoLocation.lat, props.selectedPhotoLocation.lng);
    if (selectedPoint) {
      context.strokeStyle = "#ff9f1c";
      context.lineWidth = 2;

      context.beginPath();
      context.arc(selectedPoint.x, selectedPoint.y, 10, 0, Math.PI * 2);
      context.stroke();

      context.beginPath();
      context.moveTo(selectedPoint.x - 12, selectedPoint.y);
      context.lineTo(selectedPoint.x + 12, selectedPoint.y);
      context.moveTo(selectedPoint.x, selectedPoint.y - 12);
      context.lineTo(selectedPoint.x, selectedPoint.y + 12);
      context.stroke();
    }
  }
}

async function loadImage(blob: Blob | null): Promise<void> {
  releaseObjectUrl();
  loadedImage.value = null;

  if (!blob) {
    drawOverlay();
    return;
  }

  const url = URL.createObjectURL(blob);
  currentObjectUrl.value = url;
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load map image."));
    image.src = url;
  });

  zoomLevel.value = 1;
  panX.value = 0;
  panY.value = 0;
  interactionMode.value = "select";
  loadedImage.value = image;
  drawOverlay();
}

function onPointerDown(event: PointerEvent): void {
  if (!loadedImage.value || !canvasRef.value) {
    return;
  }

  if (interactionMode.value === "select") {
    const canvasPoint = getCanvasPointFromPointer(event);
    if (!canvasPoint) {
      return;
    }

    const hitPhotos = getPhotosNearCanvasPoint(canvasPoint);
    if (hitPhotos.length > 0) {
      emit("photo-marker-click", hitPhotos);
      return;
    }

    const imagePoint = canvasPointToImagePoint(canvasPoint);
    if (imagePoint) {
      emit("image-click", imagePoint);
    }
    return;
  }

  if (!canPan.value) {
    return;
  }

  dragState.active = true;
  dragState.pointerId = event.pointerId;
  dragState.startClientX = event.clientX;
  dragState.startClientY = event.clientY;
  dragState.startPanX = panX.value;
  dragState.startPanY = panY.value;

  canvasRef.value.setPointerCapture(event.pointerId);
  isDragging.value = true;
}

function onPointerMove(event: PointerEvent): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) {
    return;
  }

  const deltaX = event.clientX - dragState.startClientX;
  const deltaY = event.clientY - dragState.startClientY;

  panX.value = dragState.startPanX + deltaX;
  panY.value = dragState.startPanY + deltaY;
  drawOverlay();
}

function onPointerUp(event: PointerEvent): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) {
    return;
  }

  finishDrag();
}

function onPointerCancel(event: PointerEvent): void {
  if (!dragState.active || event.pointerId !== dragState.pointerId) {
    return;
  }

  finishDrag();
}

watch(
  () => props.mapBlob,
  (blob) => {
    loadImage(blob).catch(() => {
      loadedImage.value = null;
      drawOverlay();
    });
  },
  { immediate: true }
);

watch(
  () => [props.calibration, props.currentPosition, props.selectedPhotoLocation, props.points, props.photos],
  () => {
    drawOverlay();
  },
  { deep: true }
);

onMounted(() => {
  window.addEventListener("resize", drawOverlay);
  drawOverlay();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", drawOverlay);
  finishDrag();
  releaseObjectUrl();
});
</script>

<style scoped>
.map-canvas-shell {
  width: 100%;
}

.map-canvas-wrap {
  position: relative;
}

.map-canvas {
  display: block;
  width: 100%;
  border-radius: 14px;
  border: 1px solid #cad2d8;
  background: #e6ecef;
  touch-action: none;
}

.map-canvas.pannable {
  cursor: grab;
}

.map-canvas.dragging {
  cursor: grabbing;
}

.map-canvas.selectable {
  cursor: crosshair;
}

.interaction-controls {
  position: absolute;
  top: 0.65rem;
  left: 0.65rem;
  display: flex;
  gap: 0.35rem;
}

.mode-button {
  border: 1px solid #6e8694;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  color: #153547;
  min-width: 3.5rem;
  height: 2.1rem;
  font-weight: 700;
  cursor: pointer;
}

.mode-button.active {
  border-color: #124559;
  background: #124559;
  color: #ffffff;
}

.mode-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.zoom-controls {
  position: absolute;
  top: 0.65rem;
  right: 0.65rem;
  display: flex;
  gap: 0.35rem;
}

.zoom-button {
  border: 1px solid #6e8694;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  color: #153547;
  min-width: 2.2rem;
  height: 2.1rem;
  font-weight: 700;
  cursor: pointer;
}

.zoom-level {
  min-width: 3.6rem;
  font-size: 0.83rem;
}

.zoom-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.map-caption {
  margin-top: 0.4rem;
  color: #415a68;
  font-size: 0.92rem;
}
</style>

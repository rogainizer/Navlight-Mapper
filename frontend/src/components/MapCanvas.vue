<template>
  <div ref="containerRef" class="map-canvas-shell">
    <div ref="canvasWrapRef" class="map-canvas-wrap">
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
        @pointerleave="onPointerLeave"
        @pointercancel="onPointerCancel"
      ></canvas>

      <div
        v-if="hoverTooltipVisible"
        class="marker-hover-tooltip"
        :style="{ left: `${hoverTooltipX}px`, top: `${hoverTooltipY}px` }"
      >
        {{ hoverTooltipText }}
      </div>

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
  CommentRecord,
  GeoPoint,
  ImagePoint,
  LivePosition,
  PhotoRecord,
  RoutePoint,
  ServerRoute,
  TrackPointRecord
} from "../types";

const props = defineProps<{
  mapBlob: Blob | null;
  calibration: CalibrationModel | null;
  suppressMarkerClicks?: boolean;
  selectLocationOnMarkerClick?: boolean;
  currentPosition: LivePosition | null;
  selectedPhotoLocation: GeoPoint | null;
  selectedCommentLocation: GeoPoint | null;
  pickupMarker: GeoPoint | null;
  dropoffMarker: GeoPoint | null;
  points: TrackPointRecord[];
  photos: PhotoRecord[];
  comments: CommentRecord[];
  routes: ServerRoute[];
  routeDraftPoints: RoutePoint[];
  routeDraftColor: string;
}>();

const emit = defineEmits<{
  (event: "image-click", point: ImagePoint): void;
  (event: "photo-marker-click", photos: PhotoRecord[]): void;
  (event: "comment-marker-click", comments: CommentRecord[]): void;
  (event: "overlap-marker-click", markers: { photos: PhotoRecord[]; comments: CommentRecord[] }): void;
  (event: "current-position-coverage-change", isOnMap: boolean | null): void;
}>();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const PHOTO_MARKER_RADIUS = 12;
const PHOTO_MARKER_HIT_PADDING = 6;
const COMMENT_MARKER_RADIUS = 12;
const COMMENT_MARKER_HIT_PADDING = 6;
const ACTION_MARKER_RADIUS = 13;
const ACTION_MARKER_HIT_PADDING = 6;
const ROUTE_HOVER_DISTANCE_PX = 8;
const EARTH_RADIUS_KM = 6371;
const TOOLTIP_OFFSET_X = 12;
const TOOLTIP_OFFSET_Y = 14;
type InteractionMode = "select" | "pan";

const containerRef = ref<HTMLDivElement | null>(null);
const canvasWrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const loadedImage = ref<HTMLImageElement | null>(null);
const currentObjectUrl = ref<string | null>(null);
const zoomLevel = ref(1);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
const interactionMode = ref<InteractionMode>("select");
const hoverTooltipVisible = ref(false);
const hoverTooltipText = ref("");
const hoverTooltipX = ref(0);
const hoverTooltipY = ref(0);

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

let lastCurrentPositionCoverage: boolean | null = null;

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
    return "Pan mode: drag the map. Use the mouse wheel to zoom. Switch to Select mode to pick calibration/photo points.";
  }
  return "Select mode: tap map for actions, markers, and map locations. Use the mouse wheel to zoom and switch to Pan mode to drag.";
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

function setZoom(value: number, focusCanvasPoint: ImagePoint | null = null): void {
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
  const image = loadedImage.value;

  let focusImageX: number | null = null;
  let focusImageY: number | null = null;

  if (image && focusCanvasPoint && drawState.scaleX > 0 && drawState.scaleY > 0) {
    focusImageX = (focusCanvasPoint.x - drawState.offsetX) / drawState.scaleX;
    focusImageY = (focusCanvasPoint.y - drawState.offsetY) / drawState.scaleY;
  }

  zoomLevel.value = clamped;

  if (zoomLevel.value <= 1) {
    panX.value = 0;
    panY.value = 0;
    if (interactionMode.value === "pan") {
      interactionMode.value = "select";
    }

    drawOverlay();
    return;
  }

  if (image && focusCanvasPoint && focusImageX !== null && focusImageY !== null) {
    const viewportWidth = drawState.width || canvasRef.value?.clientWidth || image.naturalWidth;
    const viewportHeight = drawState.height || canvasRef.value?.clientHeight || image.naturalHeight;
    const drawWidth = viewportWidth * zoomLevel.value;
    const drawHeight = viewportHeight * zoomLevel.value;
    const baseOffsetX = (viewportWidth - drawWidth) / 2;
    const baseOffsetY = (viewportHeight - drawHeight) / 2;
    const scaleX = drawWidth / image.naturalWidth;
    const scaleY = drawHeight / image.naturalHeight;

    panX.value = focusCanvasPoint.x - baseOffsetX - focusImageX * scaleX;
    panY.value = focusCanvasPoint.y - baseOffsetY - focusImageY * scaleY;
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

function onWheel(event: WheelEvent): void {
  if (!loadedImage.value) {
    return;
  }

  const canvasPoint = getCanvasPointFromClientPosition(event);
  const zoomFactor = Math.exp(-event.deltaY * 0.0015);
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return;
  }

  setZoom(zoomLevel.value * zoomFactor, canvasPoint);
}

function onWheelEvent(event: WheelEvent): void {
  if (!loadedImage.value) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  onWheel(event);
}

function setInteractionMode(mode: InteractionMode): void {
  interactionMode.value = mode;

  if (mode === "pan") {
    if (zoomLevel.value <= 1) {
      // Entering pan mode at 100% can feel broken, so nudge zoom in slightly.
      setZoom(1.25);
    } else {
      drawOverlay();
    }

    hideHoverTooltip();
    return;
  }

  finishDrag();
  hideHoverTooltip();
  drawOverlay();
}

function hideHoverTooltip(): void {
  hoverTooltipVisible.value = false;
  hoverTooltipText.value = "";
}

function truncateComment(commentText: string): string {
  const normalized = commentText.trim().replace(/\s+/g, " ");
  if (normalized.length <= 64) {
    return normalized;
  }

  return `${normalized.slice(0, 61).trimEnd()}...`;
}

function isCanvasPointNearMarker(canvasPoint: ImagePoint, markerPoint: ImagePoint, radius: number): boolean {
  const dx = canvasPoint.x - markerPoint.x;
  const dy = canvasPoint.y - markerPoint.y;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceSquaredToSegment(point: ImagePoint, start: ImagePoint, end: ImagePoint): number {
  const segmentDx = end.x - start.x;
  const segmentDy = end.y - start.y;
  const segmentLengthSq = segmentDx * segmentDx + segmentDy * segmentDy;

  if (segmentLengthSq <= Number.EPSILON) {
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return dx * dx + dy * dy;
  }

  const projected =
    ((point.x - start.x) * segmentDx + (point.y - start.y) * segmentDy) / segmentLengthSq;
  const t = Math.max(0, Math.min(1, projected));
  const closestX = start.x + t * segmentDx;
  const closestY = start.y + t * segmentDy;
  const dx = point.x - closestX;
  const dy = point.y - closestY;

  return dx * dx + dy * dy;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function getDistanceKmBetweenRoutePoints(start: RoutePoint, end: RoutePoint): number {
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const startLatRad = toRadians(start.lat);
  const endLatRad = toRadians(end.lat);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLatRad) * Math.cos(endLatRad) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

function getRouteLengthKm(routePoints: RoutePoint[]): number {
  if (routePoints.length < 2) {
    return 0;
  }

  let lengthKm = 0;
  for (let index = 1; index < routePoints.length; index += 1) {
    lengthKm += getDistanceKmBetweenRoutePoints(routePoints[index - 1], routePoints[index]);
  }

  return lengthKm;
}

function formatRouteLengthKm(lengthKm: number): string {
  if (lengthKm >= 10) {
    return `${lengthKm.toFixed(1)} km`;
  }

  if (lengthKm >= 1) {
    return `${lengthKm.toFixed(2)} km`;
  }

  return `${lengthKm.toFixed(3)} km`;
}

function getRouteHoverDescription(canvasPoint: ImagePoint): string | null {
  if (!props.calibration || props.routes.length === 0) {
    return null;
  }

  const maxDistanceSq = ROUTE_HOVER_DISTANCE_PX * ROUTE_HOVER_DISTANCE_PX;
  let closestRoute: ServerRoute | null = null;
  let closestDistanceSq = Number.POSITIVE_INFINITY;

  props.routes.forEach((route) => {
    const routePoints = toCanvasRoutePoints(route.points);
    if (routePoints.length < 2) {
      return;
    }

    for (let index = 1; index < routePoints.length; index += 1) {
      const distanceSq = distanceSquaredToSegment(canvasPoint, routePoints[index - 1], routePoints[index]);
      if (distanceSq <= maxDistanceSq && distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closestRoute = route;
      }
    }
  });

  if (!closestRoute) {
    return null;
  }

  const routeLengthText = formatRouteLengthKm(getRouteLengthKm(closestRoute.points));
  return `Route: ${closestRoute.name} (${routeLengthText})`;
}

function getHoverMarkerDescription(canvasPoint: ImagePoint): string | null {
  const pickupPoint = props.pickupMarker ? toCanvasPoint(props.pickupMarker.lat, props.pickupMarker.lng) : null;
  if (
    pickupPoint &&
    isCanvasPointNearMarker(canvasPoint, pickupPoint, ACTION_MARKER_RADIUS + ACTION_MARKER_HIT_PADDING)
  ) {
    return "Pickup marker (red cross)";
  }

  const dropoffPoint = props.dropoffMarker ? toCanvasPoint(props.dropoffMarker.lat, props.dropoffMarker.lng) : null;
  if (
    dropoffPoint &&
    isCanvasPointNearMarker(canvasPoint, dropoffPoint, ACTION_MARKER_RADIUS + ACTION_MARKER_HIT_PADDING)
  ) {
    return "Drop-off marker (green tick)";
  }

  const hitComments = getCommentsNearCanvasPoint(canvasPoint);
  const hitPhotos = getPhotosNearCanvasPoint(canvasPoint);

  if (hitComments.length > 0 && hitPhotos.length > 0) {
    return `${hitPhotos.length} photo${hitPhotos.length === 1 ? "" : "s"}, ${hitComments.length} comment${
      hitComments.length === 1 ? "" : "s"
    }`;
  }

  if (hitComments.length > 1) {
    return `${hitComments.length} comments`;
  }

  if (hitComments.length === 1) {
    return `Comment: ${truncateComment(hitComments[0].commentText)}`;
  }

  if (hitPhotos.length > 1) {
    return `${hitPhotos.length} photos`;
  }

  if (hitPhotos.length === 1) {
    return `Photo: ${hitPhotos[0].fileName}`;
  }

  const routeDescription = getRouteHoverDescription(canvasPoint);
  if (routeDescription) {
    return routeDescription;
  }

  return null;
}

function updateHoverTooltip(event: PointerEvent): void {
  if (!loadedImage.value || interactionMode.value !== "select" || event.pointerType !== "mouse") {
    hideHoverTooltip();
    return;
  }

  const canvasPoint = getCanvasPointFromClientPosition(event);
  if (!canvasPoint) {
    hideHoverTooltip();
    return;
  }

  const description = getHoverMarkerDescription(canvasPoint);
  if (!description) {
    hideHoverTooltip();
    return;
  }

  const canvasWidth = drawState.width || canvasRef.value?.clientWidth || 0;
  const canvasHeight = drawState.height || canvasRef.value?.clientHeight || 0;

  hoverTooltipText.value = description;
  hoverTooltipX.value = Math.max(6, Math.min(canvasPoint.x + TOOLTIP_OFFSET_X, canvasWidth - 6));
  hoverTooltipY.value = Math.max(6, Math.min(canvasPoint.y + TOOLTIP_OFFSET_Y, canvasHeight - 6));
  hoverTooltipVisible.value = true;
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

function toCanvasRoutePoints(routePoints: RoutePoint[]): ImagePoint[] {
  return routePoints
    .map((point) => toCanvasPoint(point.lat, point.lng))
    .filter((point): point is ImagePoint => point !== null);
}

function drawRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

function drawPhotoMarker(context: CanvasRenderingContext2D, point: ImagePoint): void {
  const radius = PHOTO_MARKER_RADIUS;

  context.save();

  context.shadowColor = "rgba(15, 23, 42, 0.32)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;

  context.fillStyle = "#ef476f";
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = "transparent";

  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  const bodyWidth = radius * 1.1;
  const bodyHeight = radius * 0.72;
  const bodyX = point.x - bodyWidth / 2;
  const bodyY = point.y - bodyHeight / 2 + 0.8;

  context.strokeStyle = "#ffffff";
  context.lineWidth = 1.7;
  drawRoundedRectPath(context, bodyX, bodyY, bodyWidth, bodyHeight, 2.5);
  context.stroke();

  const topWidth = radius * 0.36;
  const topHeight = radius * 0.18;
  const topX = bodyX + radius * 0.08;
  const topY = bodyY - topHeight - 1;
  drawRoundedRectPath(context, topX, topY, topWidth, topHeight, 1);
  context.stroke();

  context.beginPath();
  context.arc(point.x, point.y + 0.5, radius * 0.24, 0, Math.PI * 2);
  context.stroke();

  context.restore();
}

function drawCommentMarker(context: CanvasRenderingContext2D, point: ImagePoint): void {
  const radius = COMMENT_MARKER_RADIUS;
  const bubbleWidth = radius * 1.55;
  const bubbleHeight = radius * 1.15;
  const bubbleX = point.x - bubbleWidth / 2;
  const bubbleY = point.y - bubbleHeight / 2 - 2;

  context.save();

  context.shadowColor = "rgba(15, 23, 42, 0.28)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;

  context.fillStyle = "#f4a261";
  drawRoundedRectPath(context, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 4);
  context.fill();

  context.shadowColor = "transparent";

  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.beginPath();
  context.moveTo(point.x - 3, bubbleY + bubbleHeight - 1);
  context.lineTo(point.x + 2, bubbleY + bubbleHeight - 1);
  context.lineTo(point.x - 1, bubbleY + bubbleHeight + 5);
  context.closePath();
  context.fillStyle = "#f4a261";
  context.fill();
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.fillStyle = "#ffffff";
  const dotY = bubbleY + bubbleHeight / 2;
  const dotRadius = 1.35;
  [-4, 0, 4].forEach((offset) => {
    context.beginPath();
    context.arc(point.x + offset, dotY, dotRadius, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function drawDropoffMarker(context: CanvasRenderingContext2D, point: ImagePoint): void {
  context.save();

  context.shadowColor = "rgba(15, 23, 42, 0.28)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;

  context.fillStyle = "#2a9d47";
  context.beginPath();
  context.arc(point.x, point.y, ACTION_MARKER_RADIUS, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = "transparent";
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(point.x - 5, point.y + 0.5);
  context.lineTo(point.x - 1, point.y + 4.5);
  context.lineTo(point.x + 6, point.y - 4);
  context.stroke();

  context.restore();
}

function drawPickupMarker(context: CanvasRenderingContext2D, point: ImagePoint): void {
  context.save();

  context.shadowColor = "rgba(15, 23, 42, 0.28)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 2;

  context.fillStyle = "#d62839";
  context.beginPath();
  context.arc(point.x, point.y, ACTION_MARKER_RADIUS, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = "transparent";
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(point.x - 5, point.y - 5);
  context.lineTo(point.x + 5, point.y + 5);
  context.moveTo(point.x + 5, point.y - 5);
  context.lineTo(point.x - 5, point.y + 5);
  context.stroke();

  context.restore();
}

function getCanvasPointFromClientPosition(event: { clientX: number; clientY: number }): ImagePoint | null {
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

function getCommentsNearCanvasPoint(canvasPoint: ImagePoint): CommentRecord[] {
  if (!props.calibration || props.comments.length === 0) {
    return [];
  }

  const hitRadius = COMMENT_MARKER_RADIUS + COMMENT_MARKER_HIT_PADDING + 2;
  const hitRadiusSq = hitRadius * hitRadius;

  return props.comments.filter((comment) => {
    const point = toCanvasPoint(comment.lat, comment.lng);
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

function getCurrentPositionCoverage(): boolean | null {
  if (!props.currentPosition || !props.calibration || !loadedImage.value) {
    return null;
  }

  const imagePoint = geoToImagePoint(props.calibration as CalibrationModel, props.currentPosition.lat, props.currentPosition.lng);
  if (!Number.isFinite(imagePoint.x) || !Number.isFinite(imagePoint.y)) {
    return false;
  }

  return (
    imagePoint.x >= 0 &&
    imagePoint.y >= 0 &&
    imagePoint.x <= loadedImage.value.naturalWidth &&
    imagePoint.y <= loadedImage.value.naturalHeight
  );
}

function emitCurrentPositionCoverageIfChanged(): void {
  const coverage = getCurrentPositionCoverage();
  if (coverage === lastCurrentPositionCoverage) {
    return;
  }

  lastCurrentPositionCoverage = coverage;
  emit("current-position-coverage-change", coverage);
}

function drawOverlay(): void {
  emitCurrentPositionCoverageIfChanged();

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
    context.lineJoin = "round";
    context.lineCap = "round";
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

  props.routes.forEach((route) => {
    const routePoints = toCanvasRoutePoints(route.points);
    if (routePoints.length < 2) {
      return;
    }

    context.strokeStyle = route.color;
    context.lineWidth = 4;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    routePoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();

    const first = routePoints[0];
    context.fillStyle = "rgba(18, 39, 52, 0.85)";
    context.font = "12px sans-serif";
    context.fillText(route.name, first.x + 8, first.y - 8);
  });

  const draftRoutePoints = toCanvasRoutePoints(props.routeDraftPoints);
  if (draftRoutePoints.length > 0) {
    context.strokeStyle = props.routeDraftColor;
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.setLineDash([8, 5]);

    if (draftRoutePoints.length > 1) {
      context.beginPath();
      draftRoutePoints.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.stroke();
    }

    context.setLineDash([]);

    context.fillStyle = props.routeDraftColor;
    draftRoutePoints.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
    });
  }

  props.photos.forEach((photo) => {
    const point = toCanvasPoint(photo.lat, photo.lng);
    if (!point) {
      return;
    }
    drawPhotoMarker(context, point);
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

  if (interactionMode.value === "select" && props.selectedPhotoLocation) {
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

  props.comments.forEach((comment) => {
    const point = toCanvasPoint(comment.lat, comment.lng);
    if (!point) {
      return;
    }

    drawCommentMarker(context, point);
  });

  if (props.dropoffMarker) {
    const dropoffPoint = toCanvasPoint(props.dropoffMarker.lat, props.dropoffMarker.lng);
    if (dropoffPoint) {
      drawDropoffMarker(context, dropoffPoint);
    }
  }

  if (props.pickupMarker) {
    const pickupPoint = toCanvasPoint(props.pickupMarker.lat, props.pickupMarker.lng);
    if (pickupPoint) {
      drawPickupMarker(context, pickupPoint);
    }
  }

  if (interactionMode.value === "select" && props.selectedCommentLocation) {
    const selectedPoint = toCanvasPoint(props.selectedCommentLocation.lat, props.selectedCommentLocation.lng);
    if (selectedPoint) {
      context.strokeStyle = "#2563eb";
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

  hideHoverTooltip();

  if (interactionMode.value === "select") {
    const canvasPoint = getCanvasPointFromClientPosition(event);
    if (!canvasPoint) {
      return;
    }

    const imagePoint = canvasPointToImagePoint(canvasPoint);

    if (!props.suppressMarkerClicks) {
      const hitPhotos = getPhotosNearCanvasPoint(canvasPoint);
      const hitComments = getCommentsNearCanvasPoint(canvasPoint);

      if (hitPhotos.length > 0 && hitComments.length > 0) {
        if (props.selectLocationOnMarkerClick && imagePoint) {
          emit("image-click", imagePoint);
        }
        emit("overlap-marker-click", {
          photos: hitPhotos,
          comments: hitComments
        });
        return;
      }

      if (hitPhotos.length > 0) {
        if (props.selectLocationOnMarkerClick && imagePoint) {
          emit("image-click", imagePoint);
        }
        emit("photo-marker-click", hitPhotos);
        return;
      }

      if (hitComments.length > 0) {
        if (props.selectLocationOnMarkerClick && imagePoint) {
          emit("image-click", imagePoint);
        }
        emit("comment-marker-click", hitComments);
        return;
      }
    }

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
  if (dragState.active && event.pointerId === dragState.pointerId) {
    const deltaX = event.clientX - dragState.startClientX;
    const deltaY = event.clientY - dragState.startClientY;

    panX.value = dragState.startPanX + deltaX;
    panY.value = dragState.startPanY + deltaY;
    drawOverlay();
    return;
  }

  if (interactionMode.value === "select") {
    updateHoverTooltip(event);
    return;
  }

  hideHoverTooltip();
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

function onPointerLeave(): void {
  hideHoverTooltip();
}

watch(
  () => props.mapBlob,
  (blob) => {
    lastCurrentPositionCoverage = null;
    loadImage(blob).catch(() => {
      loadedImage.value = null;
      drawOverlay();
    });
  },
  { immediate: true }
);

watch(
  () => [
    props.calibration,
    props.currentPosition,
    props.selectedPhotoLocation,
    props.selectedCommentLocation,
    props.pickupMarker,
    props.dropoffMarker,
    props.points,
    props.photos,
    props.comments,
    props.routes,
    props.routeDraftPoints,
    props.routeDraftColor
  ],
  () => {
    drawOverlay();
  },
  { deep: true }
);

onMounted(() => {
  if (canvasWrapRef.value) {
    canvasWrapRef.value.addEventListener("wheel", onWheelEvent, { passive: false });
  }

  window.addEventListener("resize", drawOverlay);
  drawOverlay();
});

onBeforeUnmount(() => {
  if (canvasWrapRef.value) {
    canvasWrapRef.value.removeEventListener("wheel", onWheelEvent);
  }

  hideHoverTooltip();
  window.removeEventListener("resize", drawOverlay);
  finishDrag();
  releaseObjectUrl();
  lastCurrentPositionCoverage = null;
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

.marker-hover-tooltip {
  position: absolute;
  z-index: 4;
  max-width: min(76vw, 280px);
  padding: 0.34rem 0.52rem;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.92);
  color: #ffffff;
  font-size: 0.76rem;
  line-height: 1.28;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.32);
  pointer-events: none;
  transform: translate3d(0, 0, 0);
}

.map-caption {
  margin-top: 0.4rem;
  color: #415a68;
  font-size: 0.92rem;
}
</style>

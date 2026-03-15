<template>
  <section class="panel">
    <div class="panel-header">
      <h2>Map Calibration</h2>
      <p>Select a row, tap map, then enter GPS coordinates.</p>
    </div>

    <div class="rows">
      <div v-for="(row, index) in rows" :key="index" class="row">
        <button
          class="point-button"
          :class="{ active: selectedIndex === index }"
          type="button"
          @click="selectedIndex = index"
          :disabled="disabled"
        >
          Point {{ index + 1 }}
        </button>

        <div class="fields">
          <label>
            X
            <input v-model="row.imageX" type="number" step="0.1" :disabled="disabled" />
          </label>
          <label>
            Y
            <input v-model="row.imageY" type="number" step="0.1" :disabled="disabled" />
          </label>
          <label>
            Lat
            <input v-model="row.lat" type="number" step="0.000001" :disabled="disabled" />
          </label>
          <label>
            Lng
            <input v-model="row.lng" type="number" step="0.000001" :disabled="disabled" />
          </label>
        </div>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="primary" @click="saveCalibration" :disabled="disabled">Save Calibration</button>
      <p v-if="message" class="message">{{ message }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { CalibrationModel, ControlPoint, ImagePoint } from "../types";

const props = defineProps<{
  lastImageClick: ImagePoint | null;
  savedCalibration: CalibrationModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "save", points: [ControlPoint, ControlPoint, ControlPoint]): void;
}>();

interface EditablePoint {
  imageX: string;
  imageY: string;
  lat: string;
  lng: string;
}

const createEmptyPoint = (): EditablePoint => ({
  imageX: "",
  imageY: "",
  lat: "",
  lng: ""
});

const rows = ref<EditablePoint[]>([createEmptyPoint(), createEmptyPoint(), createEmptyPoint()]);
const selectedIndex = ref(0);
const message = ref("");

watch(
  () => props.savedCalibration,
  (calibration) => {
    if (!calibration) {
      return;
    }
    rows.value = calibration.controlPoints.map((point) => ({
      imageX: point.imageX.toFixed(1),
      imageY: point.imageY.toFixed(1),
      lat: point.lat.toFixed(6),
      lng: point.lng.toFixed(6)
    }));
  },
  { immediate: true }
);

watch(
  () => props.lastImageClick,
  (point) => {
    if (!point) {
      return;
    }
    rows.value[selectedIndex.value].imageX = point.x.toFixed(1);
    rows.value[selectedIndex.value].imageY = point.y.toFixed(1);
    message.value = `Point ${selectedIndex.value + 1} image coordinates captured.`;
  }
);

function saveCalibration(): void {
  const parsedPoints = rows.value.map((row) => ({
    imageX: Number(row.imageX),
    imageY: Number(row.imageY),
    lat: Number(row.lat),
    lng: Number(row.lng)
  }));

  const valid = parsedPoints.every(
    (point) =>
      Number.isFinite(point.imageX) &&
      Number.isFinite(point.imageY) &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng)
  );

  if (!valid) {
    message.value = "Each calibration point requires image X/Y and GPS lat/lng values.";
    return;
  }

  emit("save", parsedPoints as [ControlPoint, ControlPoint, ControlPoint]);
  message.value = "Calibration points saved.";
}
</script>

<style scoped>
.panel {
  display: grid;
  gap: 0.8rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1rem;
}

.panel-header p {
  margin: 0.3rem 0 0;
  color: #516776;
  font-size: 0.9rem;
}

.rows {
  display: grid;
  gap: 0.7rem;
}

.row {
  border: 1px solid #d1dae0;
  border-radius: 10px;
  padding: 0.6rem;
  background: #fbfcfd;
}

.point-button {
  border: 1px solid #8fa1ad;
  border-radius: 8px;
  background: #ffffff;
  color: #274353;
  font-weight: 600;
  padding: 0.35rem 0.6rem;
}

.point-button.active {
  background: #274353;
  color: #ffffff;
}

.fields {
  margin-top: 0.5rem;
  display: grid;
  gap: 0.45rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label {
  display: grid;
  gap: 0.2rem;
  color: #415a68;
  font-size: 0.84rem;
}

input {
  border: 1px solid #bdc8d0;
  border-radius: 6px;
  padding: 0.4rem 0.45rem;
}

.actions {
  display: grid;
  gap: 0.45rem;
}

.primary {
  border: none;
  border-radius: 8px;
  background: #124559;
  color: #ffffff;
  padding: 0.55rem 0.9rem;
  font-weight: 600;
}

.message {
  margin: 0;
  color: #365a6e;
  font-size: 0.86rem;
}
</style>

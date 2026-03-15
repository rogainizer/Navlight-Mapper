<template>
  <section class="panel map-manager">
    <h2>Map Selection</h2>

    <p class="hint offline-map">
      <strong>Offline map:</strong> {{ offlineMapName || "None selected" }}
    </p>

    <label>
      Server Map
      <select :value="selectedServerMapValue" @change="onSelectMap" :disabled="!online">
        <option :value="CREATE_NEW_VALUE">Create new map</option>
        <option v-for="map in serverMaps" :key="map.id" :value="map.id">{{ map.name }}</option>
      </select>
    </label>

    <p class="hint" v-if="online && serverMaps.length === 0">No maps are saved on the server yet.</p>
    <p class="hint" v-if="!online">Map selection and uploads require internet connection.</p>

    <template v-if="creatingNewMap">
      <label>
        Map Name
        <input v-model="mapName" type="text" placeholder="Park section A" :disabled="!online" />
      </label>

      <label class="file-field" :class="{ disabled: !canUpload }">
        <input type="file" accept="image/jpeg,image/jpg,image/png" :disabled="!canUpload" @change="onMapFile" />
        Load Local JPEG/PNG For Calibration
      </label>

      <div class="download-group">
        <input v-model="mapUrl" type="url" placeholder="https://.../map.jpg" :disabled="!online" />
        <button type="button" class="secondary" @click="downloadMap" :disabled="!canDownload">
          Download URL For Calibration
        </button>
      </div>

      <p class="hint">After loading a map, calibrate it and click Save Calibration to persist map + calibration.</p>
    </template>

    <p class="hint" v-else-if="activeMapId">Existing map selected. Choose Create new map to load and calibrate a new map.</p>

  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { ServerMapSummary } from "../types";

const CREATE_NEW_VALUE = "__create_new__";

const props = defineProps<{
  serverMaps: ServerMapSummary[];
  activeMapId: string | null;
  offlineMapName: string | null;
  creatingNewMap: boolean;
  online: boolean;
}>();

const emit = defineEmits<{
  (event: "select-map", mapId: string): void;
  (event: "start-create-map"): void;
  (event: "save-map-file", payload: { name: string; file: File }): void;
  (event: "download-map-url", payload: { name: string; url: string }): void;
}>();

const mapName = ref("");
const mapUrl = ref("");

const canUpload = computed(() => props.online);
const canDownload = computed(() => props.online && mapName.value.trim().length > 0 && mapUrl.value.trim().length > 0);
const selectedServerMapValue = computed(() => {
  if (props.creatingNewMap) {
    return CREATE_NEW_VALUE;
  }

  if (props.activeMapId && props.serverMaps.some((map) => map.id === props.activeMapId)) {
    return props.activeMapId;
  }

  return "";
});

function onSelectMap(event: Event): void {
  if (!props.online) {
    return;
  }

  const target = event.target as HTMLSelectElement;
  if (target.value === CREATE_NEW_VALUE) {
    emit("start-create-map");
    return;
  }

  if (target.value) {
    emit("select-map", target.value);
  }
}

function onMapFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  const resolvedName = mapName.value.trim() || file.name.replace(/\.[^/.]+$/, "");
  emit("save-map-file", { name: resolvedName, file });
  input.value = "";
}

function downloadMap(): void {
  if (!canDownload.value) {
    return;
  }

  emit("download-map-url", {
    name: mapName.value.trim(),
    url: mapUrl.value.trim()
  });
}
</script>

<style scoped>
.map-manager {
  display: grid;
  gap: 0.65rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
}

label {
  display: grid;
  gap: 0.25rem;
  color: #334b59;
  font-size: 0.87rem;
}

select,
input,
button {
  border-radius: 8px;
  border: 1px solid #bac8d1;
  padding: 0.52rem 0.6rem;
  font-size: 0.9rem;
}

.file-field {
  display: block;
  border: 1px dashed #7f99a8;
  border-radius: 10px;
  padding: 0.6rem;
  cursor: pointer;
  background: #f9fbfc;
}

.file-field.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-field input {
  width: 100%;
  border: none;
  padding: 0;
}

.download-group {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.45rem;
}

.secondary {
  background: #ffffff;
  color: #1f3f57;
  font-weight: 600;
}

.hint {
  margin: 0;
  color: #7d5130;
  font-size: 0.83rem;
}

.offline-map {
  color: #425b69;
}
</style>

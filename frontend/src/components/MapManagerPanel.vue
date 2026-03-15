<template>
  <section class="panel map-manager">
    <h2>Offline Maps</h2>

    <label>
      Active Map
      <select :value="activeMapId || ''" @change="onSelectMap">
        <option value="">Choose map</option>
        <option v-for="map in maps" :key="map.id" :value="map.id">{{ map.name }}</option>
      </select>
    </label>

    <label>
      Map Name
      <input v-model="mapName" type="text" placeholder="Park section A" />
    </label>

    <label class="file-field">
      <input type="file" accept="image/jpeg,image/jpg,image/png" @change="onMapFile" />
      Add Local JPEG/PNG
    </label>

    <div class="download-group">
      <input v-model="mapUrl" type="url" placeholder="https://.../map.jpg" />
      <button type="button" class="secondary" @click="downloadMap" :disabled="!canDownload">
        Download Map URL
      </button>
    </div>

    <p class="hint" v-if="!online">URL download requires internet connection.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { MapRecord } from "../types";

const props = defineProps<{
  maps: MapRecord[];
  activeMapId: string | null;
  online: boolean;
}>();

const emit = defineEmits<{
  (event: "select-map", mapId: string): void;
  (event: "save-map-file", payload: { name: string; file: File }): void;
  (event: "download-map-url", payload: { name: string; url: string }): void;
}>();

const mapName = ref("");
const mapUrl = ref("");

const canDownload = computed(() => props.online && mapName.value.trim().length > 0 && mapUrl.value.trim().length > 0);

function onSelectMap(event: Event): void {
  const target = event.target as HTMLSelectElement;
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
</style>

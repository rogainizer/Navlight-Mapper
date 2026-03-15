<template>
  <section class="panel photo-capture">
    <h2>Photo Capture</h2>
    <p>Take one or more photos and link them to current GPS or a map-selected location.</p>

    <div class="location-mode">
      <label class="mode-option">
        <input
          type="radio"
          name="photo-location-mode"
          value="current"
          :checked="mode === 'current'"
          @change="setMode('current')"
        />
        Use Current GPS
      </label>

      <label class="mode-option" :class="{ disabled: !canUseMapSelection }">
        <input
          type="radio"
          name="photo-location-mode"
          value="map"
          :checked="mode === 'map'"
          :disabled="!canUseMapSelection"
          @change="setMode('map')"
        />
        Select Location On Map
      </label>
    </div>

    <p v-if="mode === 'map' && selectedMapLocation" class="hint map-point">
      Selected map location: {{ selectedMapLocation.lat.toFixed(6) }}, {{ selectedMapLocation.lng.toFixed(6) }}
    </p>
    <p v-else-if="mode === 'map'" class="hint map-point">Tap the map to choose where photos should be saved.</p>

    <div class="source-section">
      <p class="source-title">Photo Source</p>
      <div class="source-actions">
        <label class="capture-label camera" :class="{ disabled: disabled }">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            :disabled="disabled"
            @change="onFileChange"
          />
          Capture From Camera
        </label>

        <label class="capture-label local" :class="{ disabled: disabled }">
          <input
            type="file"
            accept="image/*"
            multiple
            :disabled="disabled"
            @change="onFileChange"
          />
          Choose Local Files
        </label>
      </div>
    </div>

    <p class="hint" v-if="disabled">
      {{ disabledReason }}
    </p>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  disabled: boolean;
  disabledReason: string;
  mode: "current" | "map";
  canUseMapSelection: boolean;
  selectedMapLocation: { lat: number; lng: number } | null;
}>();

const emit = defineEmits<{
  (event: "capture", files: File[]): void;
  (event: "update:mode", mode: "current" | "map"): void;
}>();

function setMode(mode: "current" | "map"): void {
  emit("update:mode", mode);
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  if (files.length > 0) {
    emit("capture", files);
  }
  input.value = "";
}
</script>

<style scoped>
.photo-capture {
  display: grid;
  gap: 0.6rem;
}

.source-section {
  display: grid;
  gap: 0.4rem;
}

.source-title {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: #2b4556;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.source-actions {
  display: grid;
  gap: 0.45rem;
}

.location-mode {
  display: grid;
  gap: 0.35rem;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #2c4758;
  font-size: 0.9rem;
}

.mode-option.disabled {
  color: #92a3af;
}

h2 {
  margin: 0;
  font-size: 1rem;
}

p {
  margin: 0;
  color: #4d6575;
  font-size: 0.9rem;
}

.capture-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  font-weight: 700;
  color: #ffffff;
  background: #345995;
  cursor: pointer;
}

.capture-label.camera {
  background: #345995;
}

.capture-label.local {
  background: #2a7f62;
}

.capture-label.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capture-label input {
  display: none;
}

.hint {
  font-size: 0.85rem;
  color: #6a7c88;
}

.map-point {
  margin-top: -0.1rem;
}
</style>

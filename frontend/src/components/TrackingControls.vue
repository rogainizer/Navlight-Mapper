<template>
  <section class="panel tracking-controls">
    <h2>Movement Tracking</h2>
    <p>Track your path with manual start/stop control.</p>

    <div class="actions">
      <button type="button" class="primary" @click="$emit('start')" :disabled="!canStart || tracking">
        Start Tracking
      </button>
      <button type="button" class="secondary" @click="$emit('stop')" :disabled="!tracking">
        Stop Tracking
      </button>
    </div>

    <p class="status" :class="{ active: tracking }">
      {{ tracking ? 'Tracking active' : 'Tracking stopped' }}
    </p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  tracking: boolean;
  canStart: boolean;
}>();

defineEmits<{
  (event: "start"): void;
  (event: "stop"): void;
}>();
</script>

<style scoped>
.tracking-controls {
  display: grid;
  gap: 0.55rem;
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

.actions {
  display: grid;
  gap: 0.45rem;
  grid-template-columns: 1fr 1fr;
}

button {
  border-radius: 8px;
  padding: 0.55rem 0.5rem;
  font-weight: 600;
}

.primary {
  border: none;
  color: #ffffff;
  background: #146356;
}

.secondary {
  border: 1px solid #a3b5bf;
  color: #233a4b;
  background: #ffffff;
}

.status {
  font-size: 0.86rem;
}

.status.active {
  color: #146356;
  font-weight: 700;
}
</style>

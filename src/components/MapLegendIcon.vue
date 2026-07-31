<script setup lang="ts">
import { MAP_SYMBOL_PATHS, type MapSymbolKind } from '../gis/mapSymbols'

withDefaults(defineProps<{
  kind: MapSymbolKind
  color: string
  shape?: 'point' | 'line' | 'area'
}>(), {
  shape: 'point',
})
</script>

<template>
  <span v-if="shape === 'line'" class="map-legend-line" aria-hidden="true">
    <i :style="{ backgroundColor: color }" />
  </span>
  <span
    v-else-if="shape === 'area'"
    class="map-legend-area"
    :style="{ borderColor: color, backgroundColor: `${color}24` }"
    aria-hidden="true"
  />
  <span v-else class="map-legend-symbol" :style="{ backgroundColor: color }" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path v-for="path in MAP_SYMBOL_PATHS[kind]" :key="path" :d="path" />
    </svg>
  </span>
</template>

<style scoped>
.map-legend-symbol {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px #d7dbe0;
}
.map-legend-symbol svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: #fff;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.map-legend-line,
.map-legend-area {
  display: inline-flex;
  width: 22px;
  height: 16px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
}
.map-legend-line i {
  display: block;
  width: 22px;
  height: 3px;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
}
.map-legend-area {
  border: 1.5px solid;
  border-radius: 5px;
}
</style>

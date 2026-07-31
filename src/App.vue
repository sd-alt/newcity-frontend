<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="router-view" mode="out-in">
      <component :is="Component" :key="route.matched[0]?.path || route.path" />
    </Transition>
  </RouterView>
</template>

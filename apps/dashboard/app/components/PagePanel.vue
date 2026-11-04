<template>
  <UDashboardPanel :id="id">
    <template #header>
      <UDashboardNavbar :title="title" :icon="icon">
        <template #right>
          <slot name="actions" />
          <ThemeSelect class="hidden sm:flex" />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar v-if="$slots.toolbar">
        <slot name="toolbar" />
      </UDashboardToolbar>
    </template>
    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
const props = defineProps<{ title: string, icon?: string }>()
const id = computed(() => `panel-${props.title.toLowerCase().replace(/\W+/g, '-')}`)
useHead({ title: () => props.title })
</script>

<template>
  <USelect
    v-model="preference"
    :items="items"
    :icon="current?.icon"
    aria-label="Color theme"
    data-testid="theme-select"
    size="sm"
    class="w-32"
  />
</template>

<script setup lang="ts">
// Theme preference persists in the nx-color-mode cookie (SSR-readable, no flash) and, when signed in,
// on the user record so it follows the user across devices.
const colorMode = useColorMode()
const { state } = useSession()
const items = [
  { label: 'System', value: 'system', icon: 'i-lucide-monitor' },
  { label: 'Light', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Dark', value: 'dark', icon: 'i-lucide-moon' },
]
const current = computed(() => items.find(i => i.value === colorMode.preference))
const preference = computed({
  get: () => colorMode.preference,
  set: async (value: string) => {
    colorMode.preference = value
    if (state.value?.user) {
      await $fetch('/api/auth/me', { method: 'PATCH', body: { theme: value } }).catch(() => {})
      state.value.user.theme = value
    }
  },
})
</script>

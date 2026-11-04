<template>
  <time v-if="date" :datetime="iso" :title="iso" class="whitespace-nowrap">{{ text }}</time>
  <span v-else class="text-muted">{{ empty ?? 'never' }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ value?: string | Date | null, empty?: string }>()
const date = computed(() => (props.value ? new Date(props.value) : null))
const iso = computed(() => date.value?.toISOString())
// Relative text is computed on both server and client from the same clock tick bucket (minutes) to avoid hydration drift.
const now = useState('now-minute', () => Math.floor(Date.now() / 60000) * 60000)
const text = computed(() => {
  if (!date.value) return ''
  const diff = (now.value - date.value.getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = (n: number, unit: string) => `${Math.round(n)} ${unit}${Math.round(n) === 1 ? '' : 's'}`
  const s = abs < 60 ? 'just now' : abs < 3600 ? fmt(abs / 60, 'min') : abs < 86400 ? fmt(abs / 3600, 'hour') : fmt(abs / 86400, 'day')
  if (s === 'just now') return s
  return diff >= 0 ? `${s} ago` : `in ${s}`
})
</script>

<template>
  <figure class="space-y-1">
    <figcaption class="flex items-baseline justify-between gap-2 text-sm">
      <span class="font-medium text-highlighted">{{ title }}</span>
      <span class="text-xs text-muted">
        <template v-if="points.length">latest {{ format(points.at(-1)![1]) }} · {{ source }}</template>
      </span>
    </figcaption>
    <div v-if="!points.length" class="flex h-28 items-center justify-center rounded-md border border-dashed border-default text-sm text-muted">
      <UIcon name="i-lucide-circle-help" class="mr-1.5" /> No data — {{ emptyReason ?? 'nothing reported in this window' }}
    </div>
    <template v-else>
      <svg :viewBox="`0 0 ${W} ${H}`" class="h-28 w-full overflow-visible" role="img" :aria-label="summary" preserveAspectRatio="none">
        <line v-for="g in grid" :key="g" x1="0" :x2="W" :y1="y(g)" :y2="y(g)" class="stroke-(--ui-border)" stroke-dasharray="2 4" vector-effect="non-scaling-stroke" />
        <polyline v-for="(seg, i) in segments" :key="i" :points="seg" fill="none" class="stroke-(--ui-primary)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="flex justify-between text-[11px] text-muted">
        <span>{{ timeLabel(points[0]![0]) }}</span><span>max {{ format(maxVal) }}</span><span>{{ timeLabel(points.at(-1)![0]) }}</span>
      </div>
      <details class="text-xs text-muted">
        <summary class="cursor-pointer select-none">Data table</summary>
        <div class="max-h-40 overflow-auto">
          <table class="w-full">
            <thead><tr><th class="text-left">Time</th><th class="text-right">{{ unit || 'Value' }}</th></tr></thead>
            <tbody>
              <tr v-for="p in points.slice(-60).reverse()" :key="p[0]"><td>{{ new Date(p[0]).toLocaleString() }}</td><td class="text-right">{{ format(p[1]) }}</td></tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
  </figure>
</template>

<script setup lang="ts">
const props = defineProps<{ title: string, points: [number, number][], unit?: string, max?: number, source?: string, emptyReason?: string }>()
const W = 600
const H = 112
const maxVal = computed(() => Math.max(...props.points.map(p => p[1]), 0))
const top = computed(() => props.max ?? (maxVal.value > 0 ? maxVal.value * 1.1 : 1))
const t0 = computed(() => props.points[0]?.[0] ?? 0)
const t1 = computed(() => props.points.at(-1)?.[0] ?? 1)
const x = (t: number) => ((t - t0.value) / Math.max(1, t1.value - t0.value)) * W
const y = (v: number) => H - (Math.min(v, top.value) / top.value) * H
const grid = computed(() => [0.25, 0.5, 0.75].map(f => f * top.value))
// Gaps longer than 5× the median interval break the line: missing data is shown as missing, not interpolated.
const segments = computed(() => {
  const pts = props.points
  const gaps = pts.slice(1).map((p, i) => p[0] - pts[i]![0]).sort((a, b) => a - b)
  const limit = (gaps[Math.floor(gaps.length / 2)] ?? 60000) * 5
  const segs: string[] = []
  let cur: string[] = []
  pts.forEach((p, i) => {
    if (i > 0 && p[0] - pts[i - 1]![0] > limit) { segs.push(cur.join(' ')); cur = [] }
    cur.push(`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)
  })
  segs.push(cur.join(' '))
  return segs
})
const format = (v: number) => `${Math.round(v * 10) / 10}${props.unit ?? ''}`
const timeLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const summary = computed(() => `${props.title}: ${props.points.length} samples, latest ${format(props.points.at(-1)?.[1] ?? 0)}, max ${format(maxVal.value)}`)
</script>

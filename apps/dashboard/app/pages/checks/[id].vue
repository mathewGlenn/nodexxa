<template>
  <PagePanel :title="data?.name ?? 'Check'" icon="i-lucide-activity">
    <template #actions>
      <UButton v-if="can('ADMIN')" color="error" variant="outline" icon="i-lucide-trash-2" @click="remove">Delete</UButton>
    </template>
    <div v-if="data" class="space-y-6">
      <UCard>
        <dl class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt class="text-muted">Status</dt><dd class="mt-1"><StatusBadge :status="data.enabled ? (data.lastStatus ?? 'unknown') : 'disabled'" /></dd></div>
          <div><dt class="text-muted">Last result</dt><dd class="mt-1">{{ data.lastHttpStatus ?? '—' }} · {{ data.lastLatencyMs ?? '—' }} ms · <TimeAgo :value="data.lastCheckedAt" /></dd></div>
          <div><dt class="text-muted">Consecutive failures</dt><dd class="mt-1">{{ data.consecutiveFailures }}</dd></div>
          <div><dt class="text-muted">TLS certificate expires</dt><dd class="mt-1">{{ data.tlsExpiresAt ? fmtDate(data.tlsExpiresAt) : (data.url.startsWith('https') ? 'unknown' : 'n/a (http)') }}</dd></div>
          <div v-if="data.lastError" class="sm:col-span-2 lg:col-span-4"><dt class="text-muted">Last error</dt><dd class="mt-1 text-error">{{ data.lastError }}</dd></div>
        </dl>
      </UCard>
      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Last 24 hours</h2></template>
        <MetricChart title="Latency" unit=" ms" :points="latency" source="Nodexxa probe" />
        <p class="mt-3 text-sm text-muted">{{ okCount }} of {{ data.results.length }} probes succeeded ({{ data.results.length ? Math.round(100 * okCount / data.results.length) : 0 }}%).</p>
      </UCard>
      <UCard v-if="can('ADMIN')">
        <template #header><h2 class="font-medium text-highlighted">Edit</h2></template>
        <CheckForm :initial="(data as any)" :loading="saving" @submit="save" />
      </UCard>
      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Recent failures</h2></template>
        <ul class="divide-y divide-default text-sm">
          <li v-for="r in failures" :key="String(r.ts)" class="flex justify-between gap-3 py-1.5"><span>{{ r.error }}</span><span class="text-muted">{{ fmtDate(r.ts) }}</span></li>
          <li v-if="!failures.length" class="py-1.5 text-muted">No failures in the last 24 hours.</li>
        </ul>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const route = useRoute()
const { wsApi, can } = useSession()
const { mutate } = useApi()
const url = computed(() => wsApi(`/checks/${route.params.id}`))
const { data, refresh } = await useFetch(url, { key: `check-${route.params.id}` })
const latency = computed<[number, number][]>(() => (data.value?.results ?? []).filter(r => r.latencyMs !== null).map(r => [new Date(r.ts).getTime(), r.latencyMs!]))
const okCount = computed(() => (data.value?.results ?? []).filter(r => r.ok).length)
const failures = computed(() => (data.value?.results ?? []).filter(r => !r.ok).slice(-20).reverse())
const saving = ref(false)
async function save(body: object) {
  saving.value = true
  if (await mutate(url.value, { method: 'PUT', body, success: 'Check saved' })) await refresh()
  saving.value = false
}
async function remove() {
  if (confirm('Delete this check and its history?') && await mutate(url.value, { method: 'DELETE', success: 'Check deleted' })) await navigateTo('/checks')
}
</script>

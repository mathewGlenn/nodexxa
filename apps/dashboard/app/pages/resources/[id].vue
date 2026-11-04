<template>
  <PagePanel :title="data?.name ?? 'Resource'" :icon="icon">
    <div v-if="data" class="space-y-6">
      <UAlert
v-if="data.missingSince" color="neutral" variant="subtle" icon="i-lucide-ghost" title="No longer returned by DigitalOcean"
              :description="`Missing since ${fmtDate(data.missingSince)} (deleted, moved, or the token lost access). History is kept for 30 days.`" />
      <UAlert
v-else-if="data.connection.status !== 'OK'" color="warning" variant="subtle" icon="i-lucide-clock-alert"
              title="Provider data may be stale" :description="`Connection ${data.connection.label} is ${data.connection.status}; last successful sync ${fmtDate(data.connection.lastSyncAt)}.`" />

      <UCard>
        <dl class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt class="text-muted">Provider status</dt><dd class="mt-1"><StatusBadge :status="data.status" /></dd></div>
          <div><dt class="text-muted">Type / ID</dt><dd class="mt-1">{{ data.type }} · <code class="text-xs">{{ data.providerId }}</code></dd></div>
          <div><dt class="text-muted">Connection</dt><dd class="mt-1"><NuxtLink :to="`/connections/${data.connection.id}`" class="hover:underline">{{ data.connection.label }}</NuxtLink> <span class="text-xs text-muted">{{ data.connection.teamName }}</span></dd></div>
          <div><dt class="text-muted">Projects</dt><dd class="mt-1">{{ data.projects.map(p => p.name).join(', ') || '—' }}</dd></div>
          <div><dt class="text-muted">Region / size</dt><dd class="mt-1">{{ data.region ?? '—' }} · {{ data.size ?? '—' }}</dd></div>
          <div v-if="data.type === 'droplet'"><dt class="text-muted">Public / private IPv4</dt><dd class="mt-1 font-mono text-xs">{{ data.publicIpv4 ?? '—' }} / {{ data.privateIpv4 ?? '—' }}</dd></div>
          <div v-if="data.url"><dt class="text-muted">URL</dt><dd class="mt-1 truncate"><a :href="data.url" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">{{ data.url }}</a></dd></div>
          <div v-if="data.version"><dt class="text-muted">Version</dt><dd class="mt-1 font-mono text-xs">{{ data.version }}</dd></div>
          <div><dt class="text-muted">Tags</dt><dd class="mt-1 flex flex-wrap gap-1"><UBadge v-for="t in data.tags" :key="t" variant="outline" color="neutral">{{ t }}</UBadge><span v-if="!data.tags.length">—</span></dd></div>
          <div><dt class="text-muted">Last seen at provider</dt><dd class="mt-1">{{ fmtDate(data.lastSeenAt) }}</dd></div>
          <div><dt class="text-muted">Created</dt><dd class="mt-1">{{ fmtDate(data.providerCreatedAt) }}</dd></div>
        </dl>
      </UCard>

      <UCard v-if="data.type === 'droplet'">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-medium text-highlighted">DigitalOcean metrics (24 h)</h2>
            <span class="text-xs text-muted">Source: DigitalOcean Monitoring API · polled {{ fmtDate(data.metricsAt) }}</span>
          </div>
        </template>
        <UAlert
v-if="data.metricsStatus && data.metricsStatus !== 'ok'" class="mb-4" color="neutral" variant="subtle" icon="i-lucide-circle-help"
                :title="metricsMessage" />
        <div class="grid gap-6 md:grid-cols-2">
          <MetricChart title="CPU" unit="%" :max="100" :points="series('cpu_pct')" source="DigitalOcean" :empty-reason="metricsMessage" />
          <MetricChart title="Memory used" unit="%" :max="100" :points="series('mem_pct')" source="DigitalOcean (needs do-agent)" :empty-reason="metricsMessage" />
          <MetricChart title="Disk used (/)" unit="%" :max="100" :points="series('disk_pct')" source="DigitalOcean (needs do-agent)" :empty-reason="metricsMessage" />
          <MetricChart title="Load (1 min)" :points="series('load1')" source="DigitalOcean (needs do-agent)" :empty-reason="metricsMessage" />
        </div>
      </UCard>

      <UCard v-if="data.type === 'droplet'">
        <template #header><h2 class="font-medium text-highlighted">Nodexxa agent</h2></template>
        <p v-if="!data.agents.length" class="text-sm text-muted">No agent is linked. Agents are optional and add process-level visibility; link one from the agent’s page.</p>
        <ul v-else class="space-y-2 text-sm">
          <li v-for="a in data.agents" :key="a.id" class="flex items-center gap-2">
            <NuxtLink :to="`/agents/${a.id}`" class="hover:underline">{{ a.displayName ?? a.hostname }}</NuxtLink><StatusBadge :status="a.state" />
            <span class="text-xs text-muted">last report <TimeAgo :value="a.lastSeenAt" /></span>
          </li>
        </ul>
      </UCard>

      <UCard v-if="data.type === 'app'">
        <template #header><h2 class="font-medium text-highlighted">Deployment history (read-only)</h2></template>
        <UTable :data="data.deployments" :columns="deployColumns">
          <template #phase-cell="{ row }"><StatusBadge :status="row.original.phase" /></template>
          <template #createdAt-cell="{ row }">{{ fmtDate(row.original.createdAt) }}</template>
          <template #empty><p class="py-4 text-center text-sm text-muted">No deployments returned by DigitalOcean.</p></template>
        </UTable>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Provider fields (allow-listed)</h2></template>
        <pre class="overflow-x-auto rounded-md bg-elevated p-3 text-xs">{{ JSON.stringify(data.details, null, 2) }}</pre>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const route = useRoute()
const { wsApi } = useSession()
const { data } = await useFetch(() => wsApi(`/resources/${route.params.id}`), { key: `resource-${route.params.id}` })
const icon = computed(() => ({ droplet: 'i-lucide-server', app: 'i-lucide-app-window', database: 'i-lucide-database' })[data.value?.type ?? 'droplet'])
const series = (m: string) => ((data.value?.series as Record<string, { points: [number, number][] }>)?.[m]?.points ?? [])
const metricsMessage = computed(() => ({
  forbidden: 'Token lacks the monitoring:read scope — metrics unavailable.',
  no_data: 'DigitalOcean returned no samples (memory/disk/load require the DigitalOcean metrics agent on the Droplet).',
  error: 'Metrics request failed on the last poll.',
} as Record<string, string>)[data.value?.metricsStatus ?? ''] ?? 'Not polled yet.')
const deployColumns = [
  { accessorKey: 'phase', header: 'Phase' },
  { accessorKey: 'cause', header: 'Cause' },
  { accessorKey: 'progress', header: 'Steps' },
  { accessorKey: 'createdAt', header: 'Started' },
]
</script>

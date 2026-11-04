<template>
  <PagePanel :title="data?.displayName ?? data?.hostname ?? 'Agent'" icon="i-lucide-cpu">
    <template #actions>
      <UButton v-if="data && can('ADMIN') && data.status === 'ACTIVE'" color="error" variant="outline" icon="i-lucide-ban" data-testid="revoke-agent" @click="revoke">Revoke</UButton>
    </template>
    <div v-if="data" class="space-y-6">
      <UAlert v-if="data.state === 'revoked'" color="neutral" variant="subtle" icon="i-lucide-ban" title="Revoked" :description="`Revoked ${fmtDate(data.revokedAt)}; all further reports are rejected.`" />
      <UAlert
v-else-if="data.state !== 'online'" color="warning" variant="subtle" icon="i-lucide-clock-alert" title="Agent is not reporting"
              :description="`Everything below is the last known state (${fmtDate(data.lastSnapshotAt)}) and may be outdated. Health is unknown, not healthy.`" />

      <UCard>
        <dl class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt class="text-muted">Status</dt><dd class="mt-1"><StatusBadge :status="data.state" :label="data.state.replace('_', ' ')" /></dd></div>
          <div><dt class="text-muted">Last report</dt><dd class="mt-1"><TimeAgo :value="data.lastSeenAt" /></dd></div>
          <div><dt class="text-muted">Version / protocol</dt><dd class="mt-1">{{ data.agentVersion }} · v{{ data.protocolVersion }}</dd></div>
          <div><dt class="text-muted">Platform</dt><dd class="mt-1">{{ data.os }}/{{ data.arch }}</dd></div>
          <div><dt class="text-muted">Enrolled</dt><dd class="mt-1">{{ fmtDate(data.enrolledAt) }}</dd></div>
          <div><dt class="text-muted">Key rotated</dt><dd class="mt-1">{{ fmtDate(data.keyRotatedAt) }}</dd></div>
          <div><dt class="text-muted">Capabilities</dt><dd class="mt-1">{{ data.capabilities.join(', ') || '—' }}</dd></div>
          <div><dt class="text-muted">Uptime</dt><dd class="mt-1">{{ sys?.uptimeSec ? `${Math.floor(sys.uptimeSec / 86400)} d ${Math.floor(sys.uptimeSec % 86400 / 3600)} h` : '—' }}</dd></div>
        </dl>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">DigitalOcean Droplet link</h2></template>
        <div v-if="data.resource" class="flex flex-wrap items-center gap-3 text-sm">
          Linked to <NuxtLink :to="`/resources/${data.resource.id}`" class="text-primary hover:underline">{{ data.resource.name }}</NuxtLink>
          <span class="text-muted">({{ data.resource.connection.label }}, confirmed {{ fmtDate(data.linkedAt) }})</span>
          <UButton v-if="can('ADMIN')" size="xs" color="neutral" variant="outline" @click="link(null)">Unlink</UButton>
        </div>
        <div v-else class="space-y-3 text-sm">
          <p class="text-muted">Not linked. Links are never inferred from agent-reported hostnames or IPs; an admin must confirm them.</p>
          <div v-if="data.linkSuggestions.length" class="flex flex-wrap items-center gap-2">
            <span>Possible match by name:</span>
            <UButton v-for="s in data.linkSuggestions" :key="s.id" size="xs" color="neutral" variant="outline" :disabled="!can('ADMIN')" @click="link(s.id)">
              Link to {{ s.name }} ({{ s.connection.label }})
            </UButton>
          </div>
          <div v-if="can('ADMIN')" class="flex flex-wrap items-center gap-2">
            <USelectMenu v-model="selected" :items="dropletItems" value-key="value" placeholder="Choose a droplet…" class="w-72" />
            <UButton size="sm" :disabled="!selected" @click="link(selected!)">Link</UButton>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2"><h2 class="font-medium text-highlighted">Host metrics (24 h)</h2><span class="text-xs text-muted">Source: Nodexxa agent</span></div>
        </template>
        <div class="grid gap-6 md:grid-cols-2">
          <MetricChart title="CPU" unit="%" :max="100" :points="series('cpu_pct')" source="agent" />
          <MetricChart title="Memory used" unit="%" :max="100" :points="series('mem_pct')" source="agent" />
          <MetricChart title="Disk used (fullest)" unit="%" :max="100" :points="series('disk_pct')" source="agent" />
          <MetricChart title="Load (1 min)" :points="series('load1')" source="agent" />
        </div>
        <div v-if="sys?.filesystems?.length" class="mt-6">
          <h3 class="mb-2 text-sm font-medium">Filesystems</h3>
          <ul class="grid gap-2 text-sm sm:grid-cols-2">
            <li v-for="f in sys.filesystems" :key="f.mount" class="flex justify-between gap-2"><span class="font-mono text-xs">{{ f.mount }} ({{ f.fsType }})</span><span>{{ fmtBytes(f.usedBytes) }} / {{ fmtBytes(f.totalBytes) }}</span></li>
          </ul>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Collectors</h2></template>
        <div class="flex flex-wrap gap-2">
          <StatusBadge v-for="c in collectorList" :key="c.name" :status="c.status" :label="`${c.name}: ${c.status}${c.error ? ` — ${c.error}` : ''}`" />
          <span v-if="!collectorList.length" class="text-sm text-muted">No collector data reported yet.</span>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Processes, containers &amp; units</h2></template>
        <UTable :data="data.processes" :columns="procColumns" data-testid="agent-processes">
          <template #status-cell="{ row }"><StatusBadge :status="row.original.health === 'unhealthy' ? 'unhealthy' : row.original.status" /></template>
          <template #restarts-cell="{ row }">{{ row.original.restarts ?? '—' }}</template>
          <template #lastSeenAt-cell="{ row }"><TimeAgo :value="row.original.lastSeenAt" /></template>
          <template #empty><p class="py-4 text-center text-sm text-muted">Nothing reported (collector disabled, unavailable, or no processes).</p></template>
        </UTable>
      </UCard>

      <UCard v-if="nginx">
        <template #header><h2 class="font-medium text-highlighted">Nginx</h2></template>
        <div class="space-y-3 text-sm">
          <div class="flex gap-2"><StatusBadge :status="nginx.active === null ? 'unknown' : nginx.active ? 'active' : 'inactive'" /><span class="text-muted">{{ nginx.version }}</span></div>
          <div v-if="nginx.sites?.length">
            <h3 class="font-medium">Enabled sites (server names only)</h3>
            <ul class="mt-1 list-disc pl-5"><li v-for="(s, i) in nginx.sites" :key="i">{{ s.serverNames.join(', ') || '(default)' }} — {{ s.listen.join(', ') }}<span v-if="s.tls"> · TLS</span></li></ul>
          </div>
          <div v-if="nginx.certificates?.length">
            <h3 class="font-medium">Certificates</h3>
            <ul class="mt-1 list-disc pl-5"><li v-for="c in nginx.certificates" :key="c.subject">{{ c.subject }} — expires {{ fmtDate(c.notAfter) }}</li></ul>
          </div>
        </div>
      </UCard>

      <UCard v-if="data.agentHealth">
        <template #header><h2 class="font-medium text-highlighted">Agent self-health</h2></template>
        <dl class="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt class="text-muted">Queued snapshots</dt><dd>{{ (data.agentHealth as any).queueLength }}</dd></div>
          <div><dt class="text-muted">Dropped (queue full)</dt><dd>{{ (data.agentHealth as any).droppedSnapshots }}</dd></div>
          <div><dt class="text-muted">Last agent error</dt><dd>{{ (data.agentHealth as any).lastError ?? 'none' }}</dd></div>
        </dl>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const route = useRoute()
const { wsApi, can } = useSession()
const { mutate } = useApi()
const url = computed(() => wsApi(`/agents/${route.params.id}`))
const { data, refresh } = await useFetch(url, { key: `agent-${route.params.id}` })
const { data: droplets } = await useFetch(() => wsApi('/resources'), { query: { type: 'droplet', pageSize: 200 }, key: 'droplets-for-link', immediate: can('ADMIN') })
const dropletItems = computed(() => (droplets.value?.items ?? []).map(d => ({ label: `${d.name} (${d.connection.label})`, value: d.id })))
const selected = ref<string | undefined>()
const sys = computed(() => data.value?.system as any)
const nginx = computed(() => (data.value?.collectors as any)?.nginx as any)
const collectorList = computed(() => Object.entries((data.value?.collectors as Record<string, { status: string, error?: string } | null>) ?? {})
  .filter(([, v]) => v).map(([name, v]) => ({ name, status: v!.status, error: v!.error })))
const series = (m: string) => ((data.value?.series as Record<string, { points: [number, number][] }>)?.[m]?.points ?? [])
const procColumns = [
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'State' },
  { accessorKey: 'restarts', header: 'Restarts' },
  { accessorKey: 'lastSeenAt', header: 'Observed' },
]
async function link(resourceId: string | null) {
  if (await mutate(url.value, { method: 'PATCH', body: { resourceId }, success: resourceId ? 'Linked to droplet' : 'Unlinked' })) await refresh()
}
async function revoke() {
  if (confirm('Revoke this agent? It will be unable to send data until re-enrolled.') && await mutate(`${url.value}/revoke`, { method: 'POST', success: 'Agent revoked' })) await refresh()
}
</script>

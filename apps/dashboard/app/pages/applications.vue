<template>
  <PagePanel title="Applications" icon="i-lucide-boxes">
    <div class="space-y-8">
      <section class="space-y-3">
        <h2 class="font-medium text-highlighted">App Platform apps &amp; managed databases</h2>
        <ResourceTable />
      </section>
      <section class="space-y-3">
        <h2 class="font-medium text-highlighted">Processes reported by agents</h2>
        <p class="text-sm text-muted">PM2 processes, Docker containers and allow-listed systemd units. State is only as fresh as the reporting agent.</p>
        <div class="flex flex-wrap gap-2">
          <USelect v-model="kind" :items="kindItems" class="w-40" aria-label="Filter by process kind" />
          <USwitch v-model="onlyUnhealthy" label="Only unhealthy" />
        </div>
        <UTable :data="rows" :columns="columns" data-testid="process-table">
          <template #name-cell="{ row }"><span class="font-medium text-highlighted">{{ row.original.name }}</span></template>
          <template #status-cell="{ row }">
            <div class="flex flex-wrap gap-1">
              <StatusBadge v-if="row.original.agentState !== 'online'" status="stale" :label="`agent ${row.original.agentState.replace('_', ' ')}`" />
              <StatusBadge :status="row.original.health === 'unhealthy' ? 'unhealthy' : row.original.status" />
            </div>
          </template>
          <template #host-cell="{ row }"><NuxtLink :to="`/agents/${row.original.agentId}`" class="hover:underline">{{ row.original.host }}</NuxtLink></template>
          <template #lastSeenAt-cell="{ row }"><TimeAgo :value="row.original.lastSeenAt" /></template>
          <template #empty><p class="py-4 text-center text-sm text-muted">No processes reported. Agents are optional — enroll one under Agents.</p></template>
        </UTable>
      </section>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi } = useSession()
const kind = ref('all')
const onlyUnhealthy = ref(false)
const kindItems = [{ label: 'All kinds', value: 'all' }, { label: 'PM2', value: 'pm2' }, { label: 'Docker', value: 'docker' }, { label: 'systemd', value: 'systemd' }]
const { data } = await useFetch(() => wsApi('/processes'), { key: 'processes' })
const rows = computed(() => (data.value ?? []).filter(p => (kind.value === 'all' || p.kind === kind.value) && (!onlyUnhealthy.value || !p.healthy)))
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'status', header: 'State' },
  { accessorKey: 'restarts', header: 'Restarts' },
  { accessorKey: 'host', header: 'Host' },
  { accessorKey: 'lastSeenAt', header: 'Observed' },
]
</script>

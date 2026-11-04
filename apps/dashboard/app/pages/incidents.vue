<template>
  <PagePanel title="Incidents" icon="i-lucide-siren">
    <template #toolbar>
      <UTabs v-model="filter" :items="tabs" :content="false" size="sm" />
    </template>
    <UTable :data="data?.items ?? []" :columns="columns" data-testid="incidents-table">
      <template #title-cell="{ row }">
        <div class="font-medium text-highlighted">{{ row.original.title }}</div>
        <div class="text-xs text-muted">{{ row.original.rule?.name ?? 'Deleted rule' }}<span v-if="row.original.details"> · {{ row.original.details }}</span></div>
      </template>
      <template #severity-cell="{ row }"><StatusBadge :status="row.original.severity" :label="row.original.severity" /></template>
      <template #status-cell="{ row }"><StatusBadge :status="row.original.status" /></template>
      <template #openedAt-cell="{ row }"><TimeAgo :value="row.original.openedAt" /></template>
      <template #resolvedAt-cell="{ row }"><TimeAgo :value="row.original.resolvedAt" empty="—" /></template>
      <template #notified-cell="{ row }">
        <span class="text-xs text-muted">{{ row.original.deliveries.length ? row.original.deliveries.map(d => `${d.channel.name}: ${d.status}`).join(', ') : 'no channels' }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div v-if="row.original.status !== 'RESOLVED'" class="flex gap-1">
          <UButton v-if="row.original.status === 'OPEN'" size="xs" color="neutral" variant="outline" @click="act(row.original.id, 'acknowledge')">Acknowledge</UButton>
          <UButton v-if="can('ADMIN')" size="xs" color="neutral" variant="ghost" @click="act(row.original.id, 'resolve')">Resolve</UButton>
        </div>
      </template>
      <template #empty><UEmpty icon="i-lucide-shield-check" title="No incidents" description="Nothing matches this filter." /></template>
    </UTable>
    <div v-if="(data?.total ?? 0) > 50" class="mt-3 flex justify-end"><UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="50" /></div>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const { mutate } = useApi()
const filter = ref('active')
const page = ref(1)
const tabs = [{ label: 'Active', value: 'active' }, { label: 'Resolved', value: 'RESOLVED' }, { label: 'All', value: 'all' }]
const query = computed(() => ({ status: filter.value === 'all' ? undefined : filter.value, page: page.value }))
const { data, refresh } = await useFetch(() => wsApi('/incidents'), { query, watch: [query], key: 'incidents' })
const columns = [
  { accessorKey: 'title', header: 'Incident' },
  { accessorKey: 'severity', header: 'Severity' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'openedAt', header: 'Opened' },
  { accessorKey: 'resolvedAt', header: 'Resolved' },
  { accessorKey: 'notified', header: 'Notifications' },
  { accessorKey: 'actions', header: '' },
]
async function act(id: string, action: 'acknowledge' | 'resolve') {
  if (await mutate(wsApi(`/incidents/${id}`), { method: 'POST', body: { action }, success: action === 'acknowledge' ? 'Acknowledged' : 'Resolved' })) await refresh()
}
</script>

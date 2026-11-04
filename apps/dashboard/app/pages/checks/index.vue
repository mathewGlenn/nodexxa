<template>
  <PagePanel title="Checks" icon="i-lucide-activity">
    <template #actions>
      <UButton v-if="can('ADMIN')" icon="i-lucide-plus" data-testid="add-check" @click="open = true">Add check</UButton>
    </template>
    <UTable :data="data ?? []" :columns="columns" data-testid="checks-table">
      <template #name-cell="{ row }">
        <NuxtLink :to="`/checks/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</NuxtLink>
        <div class="max-w-xs truncate text-xs text-muted">{{ row.original.url }}</div>
      </template>
      <template #status-cell="{ row }">
        <StatusBadge v-if="!row.original.enabled" status="disabled" />
        <StatusBadge v-else-if="!row.original.lastStatus" status="unknown" label="not run yet" />
        <StatusBadge v-else :status="row.original.lastStatus" />
      </template>
      <template #latency-cell="{ row }">{{ row.original.lastLatencyMs !== null ? `${row.original.lastLatencyMs} ms` : '—' }}</template>
      <template #tls-cell="{ row }">
        <span v-if="row.original.tlsExpiresAt">{{ fmtDate(row.original.tlsExpiresAt).slice(0, 10) }}</span><span v-else class="text-muted">—</span>
      </template>
      <template #lastCheckedAt-cell="{ row }"><TimeAgo :value="row.original.lastCheckedAt" /></template>
      <template #empty><UEmpty icon="i-lucide-activity" title="No checks" description="Add HTTP(S) uptime and certificate-expiry checks for public endpoints." /></template>
    </UTable>
    <UModal v-model:open="open" title="New uptime check">
      <template #body><CheckForm :loading="saving" @submit="create" /></template>
    </UModal>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const { mutate } = useApi()
const { data, refresh } = await useFetch(() => wsApi('/checks'), { key: 'checks' })
const columns = [
  { accessorKey: 'name', header: 'Check' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'latency', header: 'Latency' },
  { accessorKey: 'intervalSec', header: 'Every (s)' },
  { accessorKey: 'tls', header: 'TLS expires' },
  { accessorKey: 'lastCheckedAt', header: 'Last run' },
]
const open = ref(false)
const saving = ref(false)
async function create(body: object) {
  saving.value = true
  const res = await mutate(wsApi('/checks'), { method: 'POST', body, success: 'Check created' })
  saving.value = false
  if (res) { open.value = false; await refresh() }
}
</script>

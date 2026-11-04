<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <UInput v-model="q" icon="i-lucide-search" placeholder="Search name, tag or IP" class="w-full sm:w-64" aria-label="Search resources" />
      <USelect v-model="connectionId" :items="connectionItems" class="w-full sm:w-52" aria-label="Filter by connection" />
      <USelect v-model="client" :items="clientItems" class="w-full sm:w-44" aria-label="Filter by client" />
      <USelect v-if="!type" v-model="typeFilter" :items="typeItems" class="w-full sm:w-40" aria-label="Filter by type" />
      <USwitch v-model="includeMissing" label="Show missing" />
    </div>
    <UTable :data="data?.items ?? []" :columns="columns" :loading="status === 'pending'" data-testid="resource-table">
      <template #name-cell="{ row }">
        <NuxtLink :to="`/resources/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.name }}</NuxtLink>
        <div class="text-xs text-muted">{{ row.original.type }} · {{ row.original.providerId }}</div>
      </template>
      <template #status-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <StatusBadge v-if="row.original.missingSince" status="missing" />
          <StatusBadge v-else :status="row.original.status" />
        </div>
      </template>
      <template #connection-cell="{ row }">
        <div>{{ row.original.connection.label }}</div>
        <div class="text-xs text-muted">{{ row.original.connection.client ?? '' }}</div>
      </template>
      <template #projects-cell="{ row }">
        <span class="text-sm">{{ row.original.projects.map(p => p.name).join(', ') || '—' }}</span>
      </template>
      <template #network-cell="{ row }">
        <span class="font-mono text-xs">{{ row.original.publicIpv4 ?? row.original.url ?? '—' }}</span>
      </template>
      <template #agent-cell="{ row }">
        <StatusBadge v-if="row.original.agents.length" :status="row.original.agents[0]!.state" :label="`agent ${row.original.agents[0]!.state.replace('_', ' ')}`" />
        <span v-else class="text-xs text-muted">no agent</span>
      </template>
      <template #lastSeenAt-cell="{ row }"><TimeAgo :value="row.original.lastSeenAt" /></template>
      <template #empty>
        <UEmpty icon="i-lucide-search-x" title="No resources" description="Nothing matches, or discovery has not completed yet." />
      </template>
    </UTable>
    <div v-if="(data?.total ?? 0) > pageSize" class="flex justify-end">
      <UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="pageSize" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ type?: 'droplet' | 'app' | 'database' }>()
const { wsApi } = useSession()
const q = ref('')
const connectionId = ref('all')
const client = ref('all')
const typeFilter = ref('all')
const includeMissing = ref(false)
const page = ref(1)
const pageSize = 50

const { data: connections } = await useFetch(() => wsApi('/connections'), { key: 'connections' })
const connectionItems = computed(() => [{ label: 'All connections', value: 'all' }, ...(connections.value ?? []).map(c => ({ label: c.label, value: c.id }))])
const clientItems = computed(() => [{ label: 'All clients', value: 'all' }, ...[...new Set((connections.value ?? []).map(c => c.client).filter(Boolean))].map(c => ({ label: c!, value: c! }))])
const typeItems = [{ label: 'All types', value: 'all' }, { label: 'Apps', value: 'app' }, { label: 'Databases', value: 'database' }]

const query = computed(() => ({
  type: props.type ?? (typeFilter.value === 'all' ? undefined : typeFilter.value),
  connectionId: connectionId.value === 'all' ? undefined : connectionId.value,
  client: client.value === 'all' ? undefined : client.value,
  q: q.value || undefined,
  includeMissing: includeMissing.value ? 'true' : undefined,
  page: page.value,
  pageSize,
}))
const { data, status } = await useFetch(() => wsApi('/resources'), { query, key: `resources-${props.type ?? 'apps'}`, watch: [query] })

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'connection', header: 'Connection' },
  { accessorKey: 'projects', header: 'Projects' },
  { accessorKey: 'region', header: 'Region' },
  ...(props.type === 'droplet' ? [{ accessorKey: 'size', header: 'Size' }, { accessorKey: 'network', header: 'Public IPv4' }, { accessorKey: 'agent', header: 'Agent' }] : [{ accessorKey: 'network', header: 'URL' }]),
  { accessorKey: 'lastSeenAt', header: 'Last seen' },
]
</script>

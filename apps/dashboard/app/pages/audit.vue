<template>
  <PagePanel title="Audit log" icon="i-lucide-scroll-text">
    <UAlert v-if="!can('ADMIN')" color="neutral" variant="subtle" title="Admins only" />
    <template v-else>
      <UTable :data="data?.items ?? []" :columns="columns" data-testid="audit-table">
        <template #createdAt-cell="{ row }">{{ fmtDate(row.original.createdAt) }}</template>
        <template #action-cell="{ row }"><code class="text-xs">{{ row.original.action }}</code></template>
        <template #target-cell="{ row }"><span class="text-xs text-muted">{{ row.original.targetType }} {{ row.original.targetId?.slice(0, 8) }}</span></template>
        <template #details-cell="{ row }"><code class="block max-w-md truncate text-xs">{{ row.original.details ? JSON.stringify(row.original.details) : '' }}</code></template>
      </UTable>
      <div v-if="(data?.total ?? 0) > 50" class="mt-3 flex justify-end"><UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="50" /></div>
    </template>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const page = ref(1)
const query = computed(() => ({ page: page.value }))
const { data } = await useFetch(() => wsApi('/audit'), { query, watch: [query], key: 'audit', immediate: can('ADMIN') })
const columns = [
  { accessorKey: 'createdAt', header: 'Time (UTC)' },
  { accessorKey: 'actorLabel', header: 'Actor' },
  { accessorKey: 'action', header: 'Action' },
  { accessorKey: 'target', header: 'Target' },
  { accessorKey: 'details', header: 'Details' },
]
</script>

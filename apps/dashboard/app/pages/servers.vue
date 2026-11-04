<template>
  <PagePanel title="Servers" icon="i-lucide-server">
    <div class="space-y-8">
      <section class="space-y-3">
        <h2 class="font-medium text-highlighted">DigitalOcean Droplets</h2>
        <ResourceTable type="droplet" />
      </section>
      <section class="space-y-3">
        <h2 class="font-medium text-highlighted">Agent hosts not linked to a Droplet</h2>
        <p class="text-sm text-muted">Custom or non-DigitalOcean servers, or agents awaiting an operator-confirmed Droplet link.</p>
        <UTable :data="unlinked" :columns="columns">
          <template #hostname-cell="{ row }">
            <NuxtLink :to="`/agents/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.displayName ?? row.original.hostname }}</NuxtLink>
          </template>
          <template #state-cell="{ row }"><StatusBadge :status="row.original.state" /></template>
          <template #lastSeenAt-cell="{ row }"><TimeAgo :value="row.original.lastSeenAt" /></template>
          <template #empty><p class="py-4 text-center text-sm text-muted">No unlinked agent hosts.</p></template>
        </UTable>
      </section>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi } = useSession()
const { data: agents } = await useFetch(() => wsApi('/agents'), { key: 'agents' })
const unlinked = computed(() => (agents.value ?? []).filter(a => !a.resourceId && a.status === 'ACTIVE'))
const columns = [
  { accessorKey: 'hostname', header: 'Host' },
  { accessorKey: 'state', header: 'Agent' },
  { accessorKey: 'agentVersion', header: 'Version' },
  { accessorKey: 'lastSeenAt', header: 'Last seen' },
]
</script>

<template>
  <PagePanel title="Overview" icon="i-lucide-layout-dashboard">
    <UEmpty v-if="!workspace" icon="i-lucide-building-2" title="No workspace" description="You are not a member of any workspace yet. Ask an owner for an invitation." />
    <div v-else-if="data" class="space-y-6">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <UCard v-for="tile in tiles" :key="tile.label" :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center gap-2 text-sm text-muted"><UIcon :name="tile.icon" />{{ tile.label }}</div>
          <div class="mt-1 text-2xl font-semibold text-highlighted">{{ tile.value }}</div>
          <div class="text-xs text-muted">{{ tile.hint }}</div>
        </UCard>
      </div>

      <UAlert
        v-if="data.worker.length === 0 || data.worker.some(w => w.stale)"
        color="warning" variant="subtle" icon="i-lucide-clock-alert"
        title="Background worker is not reporting"
        description="Discovery, checks and alert evaluation are not running; all derived health data may be stale."
      />

      <div class="grid gap-6 lg:grid-cols-2">
        <UCard>
          <template #header><h2 class="font-medium text-highlighted">Open incidents</h2></template>
          <p v-if="!data.incidents.length" class="text-sm text-muted">No open incidents.</p>
          <ul v-else class="divide-y divide-default">
            <li v-for="i in data.incidents" :key="i.id" class="flex items-center justify-between gap-3 py-2 text-sm">
              <NuxtLink to="/incidents" class="truncate hover:underline">{{ i.title }}</NuxtLink>
              <div class="flex shrink-0 items-center gap-2"><StatusBadge :status="i.severity" /><TimeAgo :value="i.openedAt" class="text-xs text-muted" /></div>
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header><h2 class="font-medium text-highlighted">DigitalOcean connections</h2></template>
          <p v-if="!data.connections.length" class="text-sm text-muted">
            No connections yet. <NuxtLink to="/connections" class="text-primary hover:underline">Connect a DigitalOcean team</NuxtLink>.
          </p>
          <ul v-else class="divide-y divide-default">
            <li v-for="c in data.connections" :key="c.id" class="flex items-center justify-between gap-3 py-2 text-sm">
              <NuxtLink :to="`/connections/${c.id}`" class="truncate hover:underline">{{ c.label }}<span v-if="c.client" class="text-muted"> · {{ c.client }}</span></NuxtLink>
              <div class="flex shrink-0 items-center gap-2">
                <StatusBadge v-if="c.stale && c.status === 'OK'" status="stale" />
                <StatusBadge :status="c.enabled ? c.status : 'disabled'" />
              </div>
            </li>
          </ul>
        </UCard>
      </div>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Worker tasks</h2></template>
        <p v-if="!data.worker.length" class="text-sm text-muted">The worker has never reported.</p>
        <div v-else class="flex flex-wrap gap-4 text-sm">
          <div v-for="w in data.worker" :key="w.task" class="flex items-center gap-2">
            <StatusBadge :status="w.stale ? 'stale' : w.lastError ? 'error' : 'ok'" :label="w.task" />
            <TimeAgo :value="w.lastRunAt" class="text-xs text-muted" />
          </div>
        </div>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { workspace, wsApi } = useSession()
const { data } = await useFetch(() => wsApi('/overview'), { key: 'overview', immediate: !!workspace.value })

const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  const count = (type: string) => d.resources.filter(r => r.type === type).reduce((s, r) => s + r.count, 0)
  const unhealthyDroplets = d.resources.filter(r => r.type === 'droplet' && r.status !== 'active').reduce((s, r) => s + r.count, 0)
  return [
    { label: 'Droplets', icon: 'i-lucide-server', value: count('droplet'), hint: unhealthyDroplets ? `${unhealthyDroplets} not active` : 'all active' },
    { label: 'Apps & databases', icon: 'i-lucide-boxes', value: count('app') + count('database'), hint: `${count('app')} apps · ${count('database')} databases` },
    { label: 'Agents online', icon: 'i-lucide-cpu', value: d.agents.online, hint: `${d.agents.stale} stale · ${d.agents.neverSeen} never reported` },
    { label: 'Checks up', icon: 'i-lucide-activity', value: d.checks.up, hint: `${d.checks.down} down · ${d.checks.unknown} not yet run` },
  ]
})
</script>

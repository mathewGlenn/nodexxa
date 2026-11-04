<template>
  <PagePanel title="Connections" icon="i-lucide-plug">
    <template #actions>
      <UButton v-if="can('ADMIN')" icon="i-lucide-plus" data-testid="add-connection" @click="open = true">Add connection</UButton>
    </template>

    <p class="mb-4 max-w-3xl text-sm text-muted">
      Each connection is one DigitalOcean team (account) authorized by its own read-only token. Tokens are encrypted at rest and never shown again after entry.
    </p>

    <UTable :data="data ?? []" :columns="columns" :loading="status === 'pending'" data-testid="connections-table">
      <template #label-cell="{ row }">
        <NuxtLink :to="`/connections/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.label }}</NuxtLink>
        <div class="text-xs text-muted">{{ row.original.client || 'No client label' }}</div>
      </template>
      <template #team-cell="{ row }">{{ row.original.teamName ?? '—' }}</template>
      <template #status-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <StatusBadge :status="row.original.enabled ? row.original.status : 'disabled'" />
          <StatusBadge v-if="row.original.stale && row.original.enabled" status="stale" label="data stale" />
        </div>
      </template>
      <template #token-cell="{ row }"><code class="text-xs">{{ row.original.tokenMasked }}</code></template>
      <template #resources-cell="{ row }">
        <span class="text-sm">{{ row.original.resourceCounts.droplet ?? 0 }} droplets · {{ row.original.resourceCounts.app ?? 0 }} apps · {{ row.original.resourceCounts.database ?? 0 }} DBs</span>
      </template>
      <template #lastSyncAt-cell="{ row }"><TimeAgo :value="row.original.lastSyncAt" /></template>
      <template #empty>
        <UEmpty icon="i-lucide-plug" title="No DigitalOcean connections" description="Add a read-only token for each team you want to monitor." />
      </template>
    </UTable>

    <UModal v-model:open="open" title="Connect a DigitalOcean team">
      <template #body>
        <UForm :schema="connectionCreateSchema" :state="form" class="space-y-4" @submit="create">
          <UFormField label="Label" name="label" help="Unique name, e.g. “GoFurther production”">
            <UInput v-model="form.label" class="w-full" data-testid="connection-label" />
          </UFormField>
          <UFormField label="Client / owner" name="client">
            <UInput v-model="form.client" class="w-full" />
          </UFormField>
          <UFormField label="API token" name="token">
            <UInput v-model="form.token" type="password" autocomplete="off" class="w-full" data-testid="connection-token" />
            <template #help>
              Create a <strong>custom-scoped, read-only</strong> token: <code>account:read</code>, <code>droplet:read</code>, <code>project:read</code>,
              <code>app:read</code>, <code>database:read</code>, <code>monitoring:read</code>. Missing scopes only hide that resource type.
            </template>
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
            <UButton type="submit" :loading="saving" data-testid="connection-submit">Verify &amp; save</UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const { mutate } = useApi()
const { data, status, refresh } = await useFetch(() => wsApi('/connections'), { key: 'connections' })
const columns = [
  { accessorKey: 'label', header: 'Connection' },
  { accessorKey: 'team', header: 'DO team' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'token', header: 'Token' },
  { accessorKey: 'resources', header: 'Resources' },
  { accessorKey: 'lastSyncAt', header: 'Last sync' },
]
const open = ref(false)
const saving = ref(false)
const form = reactive({ label: '', client: '', token: '' })

async function create() {
  saving.value = true
  const res = await mutate(wsApi('/connections'), { method: 'POST', body: form, success: 'Connection verified; first sync scheduled' })
  saving.value = false
  if (res) {
    Object.assign(form, { label: '', client: '', token: '' })
    open.value = false
    await refresh()
  }
}
</script>

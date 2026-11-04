<template>
  <PagePanel :title="data?.label ?? 'Connection'" icon="i-lucide-plug">
    <template #actions>
      <template v-if="data && can('ADMIN')">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" :disabled="!data.enabled" @click="syncNow">Sync now</UButton>
        <UButton :icon="data.enabled ? 'i-lucide-pause' : 'i-lucide-play'" color="neutral" variant="outline" @click="toggle">{{ data.enabled ? 'Disable' : 'Enable' }}</UButton>
      </template>
    </template>

    <div v-if="data" class="space-y-6">
      <UAlert v-if="data.lastError" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Last sync failed" :description="data.lastError" data-testid="connection-error" />
      <UAlert v-else-if="data.stale && data.enabled" color="warning" variant="subtle" icon="i-lucide-clock-alert" title="Inventory is stale" description="No successful sync recently; the data shown is the last known state." />

      <UCard>
        <dl class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt class="text-muted">Status</dt><dd class="mt-1 flex gap-1"><StatusBadge :status="data.enabled ? data.status : 'disabled'" /></dd></div>
          <div><dt class="text-muted">DigitalOcean team</dt><dd class="mt-1">{{ data.teamName ?? '—' }} <span v-if="data.teamUuid" class="text-xs text-muted">({{ data.teamUuid }})</span></dd></div>
          <div><dt class="text-muted">Client</dt><dd class="mt-1">{{ data.client ?? '—' }}</dd></div>
          <div><dt class="text-muted">Token</dt><dd class="mt-1"><code>{{ data.tokenMasked }}</code> · rotated <TimeAgo :value="data.tokenRotatedAt" /></dd></div>
          <div><dt class="text-muted">Last successful sync</dt><dd class="mt-1"><TimeAgo :value="data.lastSyncAt" /> <span class="text-xs text-muted">({{ fmtDate(data.lastSyncAt) }})</span></dd></div>
          <div><dt class="text-muted">Next sync</dt><dd class="mt-1"><TimeAgo :value="data.nextSyncAt" /></dd></div>
          <div><dt class="text-muted">Consecutive failures</dt><dd class="mt-1">{{ data.consecutiveFailures }}</dd></div>
          <div>
            <dt class="text-muted">API rate limit</dt>
            <dd class="mt-1">{{ data.rateLimitRemaining ?? 'unknown' }} remaining<span v-if="data.rateLimitResetAt"> · resets <TimeAgo :value="data.rateLimitResetAt" /></span></dd>
          </div>
          <div><dt class="text-muted">Resources</dt><dd class="mt-1">{{ data.resourceCounts.droplet ?? 0 }} droplets · {{ data.resourceCounts.app ?? 0 }} apps · {{ data.resourceCounts.database ?? 0 }} DBs</dd></div>
        </dl>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Token scopes observed</h2></template>
        <p v-if="!data.capabilities" class="text-sm text-muted">Not known until the first successful sync.</p>
        <div v-else class="flex flex-wrap gap-2">
          <StatusBadge v-for="(v, k) in (data.capabilities as Record<string, string>)" :key="k" :status="v" :label="`${k}: ${v === 'forbidden' ? 'scope missing' : v}`" />
        </div>
      </UCard>

      <UCard v-if="can('ADMIN')">
        <template #header><h2 class="font-medium text-highlighted">Manage</h2></template>
        <div class="grid gap-6 lg:grid-cols-2">
          <UForm :state="edit" class="space-y-3" @submit="save">
            <UFormField label="Label" name="label"><UInput v-model="edit.label" class="w-full" /></UFormField>
            <UFormField label="Client / owner" name="client"><UInput v-model="edit.client" class="w-full" /></UFormField>
            <UButton type="submit" color="neutral" variant="outline">Save details</UButton>
          </UForm>
          <UForm :state="rotate" class="space-y-3" @submit="rotateToken">
            <UFormField label="Rotate token" name="token" help="The new token is verified and must belong to the same DigitalOcean team.">
              <UInput v-model="rotate.token" type="password" autocomplete="off" class="w-full" />
            </UFormField>
            <UButton type="submit" color="neutral" variant="outline" :disabled="rotate.token.length < 20">Verify &amp; rotate</UButton>
          </UForm>
        </div>
        <USeparator class="my-6" />
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-muted">Deleting removes the encrypted token and this connection’s discovered inventory and history.</p>
          <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="remove">Delete</UButton>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Change &amp; rotation history</h2></template>
        <ul class="divide-y divide-default text-sm">
          <li v-for="h in data.history" :key="h.id" class="flex justify-between gap-3 py-2">
            <span><code>{{ h.action }}</code> by {{ h.actorLabel }}</span><span class="text-muted">{{ fmtDate(h.createdAt) }}</span>
          </li>
        </ul>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const route = useRoute()
const { wsApi, can } = useSession()
const { mutate } = useApi()
const url = computed(() => wsApi(`/connections/${route.params.id}`))
const { data, refresh } = await useFetch(url, { key: `connection-${route.params.id}` })
const edit = reactive({ label: data.value?.label ?? '', client: data.value?.client ?? '' })
const rotate = reactive({ token: '' })

const save = async () => { if (await mutate(url.value, { method: 'PATCH', body: { label: edit.label, client: edit.client || null }, success: 'Saved' })) await refresh() }
const toggle = async () => { if (await mutate(url.value, { method: 'PATCH', body: { enabled: !data.value!.enabled }, success: 'Updated' })) await refresh() }
const syncNow = async () => { if (await mutate(`${url.value}/sync`, { method: 'POST', success: 'Sync requested — the worker will pick it up shortly' })) await refresh() }
async function rotateToken() {
  if (await mutate(url.value, { method: 'PATCH', body: { token: rotate.token }, success: 'Token rotated' })) {
    rotate.token = ''
    await refresh()
  }
}
async function remove() {
  if (!confirm(`Delete connection "${data.value?.label}" and its inventory?`)) return
  if (await mutate(url.value, { method: 'DELETE', success: 'Connection deleted' })) await navigateTo('/connections')
}
</script>

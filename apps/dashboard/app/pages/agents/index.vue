<template>
  <PagePanel title="Agents" icon="i-lucide-cpu">
    <template #actions>
      <UButton v-if="can('ADMIN')" icon="i-lucide-plus" data-testid="enroll-agent" @click="startWizard">Enroll agent</UButton>
    </template>
    <p class="mb-4 max-w-3xl text-sm text-muted">
      The optional Linux agent makes outbound HTTPS requests only. It has no listening port and cannot execute commands sent from Nodexxa.
    </p>
    <UTable :data="agents ?? []" :columns="columns" data-testid="agents-table">
      <template #hostname-cell="{ row }">
        <NuxtLink :to="`/agents/${row.original.id}`" class="font-medium text-highlighted hover:underline">{{ row.original.displayName ?? row.original.hostname }}</NuxtLink>
        <div class="text-xs text-muted">{{ row.original.hostname }} · {{ row.original.arch }}</div>
      </template>
      <template #state-cell="{ row }"><StatusBadge :status="row.original.state" :label="row.original.state.replace('_', ' ')" /></template>
      <template #resource-cell="{ row }">
        <NuxtLink v-if="row.original.resource" :to="`/resources/${row.original.resource.id}`" class="hover:underline">{{ row.original.resource.name }}</NuxtLink>
        <span v-else class="text-xs text-muted">not linked</span>
      </template>
      <template #processes-cell="{ row }">
        {{ row.original.processSummary.total }}<span v-if="row.original.processSummary.unhealthy" class="text-error"> ({{ row.original.processSummary.unhealthy }} unhealthy)</span>
      </template>
      <template #lastSeenAt-cell="{ row }"><TimeAgo :value="row.original.lastSeenAt" /></template>
      <template #empty><UEmpty icon="i-lucide-cpu" title="No agents enrolled" description="Agents are optional. Enroll one to see PM2, Docker, Nginx and systemd state." /></template>
    </UTable>

    <section v-if="can('ADMIN') && tokens?.length" class="mt-8 space-y-2">
      <h2 class="font-medium text-highlighted">Recent enrollment tokens</h2>
      <ul class="divide-y divide-default text-sm">
        <li v-for="t in tokens" :key="t.id" class="flex items-center justify-between gap-3 py-2">
          <span>{{ t.label || 'Unlabelled' }} · created {{ fmtDate(t.createdAt) }}</span>
          <span class="flex items-center gap-2">
            <StatusBadge :status="t.usedAt ? 'ok' : new Date(t.expiresAt) < new Date() ? 'disabled' : 'pending'" :label="t.usedAt ? 'used' : new Date(t.expiresAt) < new Date() ? 'expired' : 'unused'" />
            <UButton v-if="!t.usedAt" size="xs" color="neutral" variant="ghost" @click="revokeToken(t.id)">Revoke</UButton>
          </span>
        </li>
      </ul>
    </section>

    <UModal v-model:open="wizard" title="Enroll a Linux agent" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div v-if="!issued" class="space-y-4">
          <p class="text-sm">Step 1 — create a one-time enrollment token. It is shown once, works for a single host and expires.</p>
          <UFormField label="Label (optional)"><UInput v-model="wizardForm.label" placeholder="e.g. api-prod-1" class="w-full" /></UFormField>
          <UFormField label="Expires after (minutes)"><UInputNumber v-model="wizardForm.ttlMinutes" :min="5" :max="1440" class="w-full" /></UFormField>
          <div class="flex justify-end"><UButton :loading="creating" data-testid="create-enrollment" @click="createToken">Create token</UButton></div>
        </div>
        <div v-else class="space-y-4 text-sm">
          <UAlert color="warning" variant="subtle" icon="i-lucide-key-round" title="Copy this token now — it will not be shown again." :description="`Expires ${fmtDate(issued.expiresAt)}.`" />
          <UFormField label="Enrollment token">
            <UInput :model-value="issued.token" readonly class="w-full font-mono" data-testid="enrollment-token" />
          </UFormField>
          <p>Step 2 — on the host, install a checksum-verified release and enroll (no <code>curl | bash</code>):</p>
          <pre class="overflow-x-auto rounded-md bg-elevated p-3 text-xs">{{ installScript }}</pre>
          <p class="text-muted">Docker monitoring is off by default: access to the Docker socket is root-equivalent. See <code>deploy/systemd/README.md</code> for opt-in collectors, rotation and uninstall.</p>
          <div class="flex justify-end"><UButton @click="finish">Done</UButton></div>
        </div>
      </template>
    </UModal>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const { mutate } = useApi()
const { data: agents } = await useFetch(() => wsApi('/agents'), { key: 'agents' })
const { data: tokens, refresh: refreshTokens } = await useFetch(() => wsApi('/enrollments'), { key: 'enrollments', immediate: can('ADMIN') })
const columns = [
  { accessorKey: 'hostname', header: 'Host' },
  { accessorKey: 'state', header: 'Status' },
  { accessorKey: 'agentVersion', header: 'Version' },
  { accessorKey: 'resource', header: 'Droplet' },
  { accessorKey: 'processes', header: 'Processes' },
  { accessorKey: 'lastSeenAt', header: 'Last report' },
]
const wizard = ref(false)
const creating = ref(false)
const wizardForm = reactive({ label: '', ttlMinutes: 60 })
const issued = ref<{ token: string, expiresAt: string } | null>(null)
const origin = useRequestURL().origin

const installScript = computed(() => `# 1. Download nodexxa-agent_<version>_linux_<arch>.tar.gz and SHA256SUMS from your release source
sha256sum --ignore-missing -c SHA256SUMS
sudo install -m 0755 nodexxa-agent /usr/local/bin/nodexxa-agent
sudo useradd --system --home /var/lib/nodexxa-agent --shell /usr/sbin/nologin nodexxa-agent
sudo install -d -m 0750 -o root -g nodexxa-agent /etc/nodexxa-agent
sudo install -d -m 0700 -o nodexxa-agent -g nodexxa-agent /var/lib/nodexxa-agent

# 2. Enroll (generates the host key locally; only the public key is sent)
sudo -u nodexxa-agent NODEXXA_ENROLLMENT_TOKEN='${issued.value?.token ?? ''}' \\
  /usr/local/bin/nodexxa-agent enroll --server ${origin} --state-dir /var/lib/nodexxa-agent

# 3. Run under systemd (unit in deploy/systemd/nodexxa-agent.service)
sudo systemctl enable --now nodexxa-agent`)

function startWizard() {
  issued.value = null
  Object.assign(wizardForm, { label: '', ttlMinutes: 60 })
  wizard.value = true
}
async function createToken() {
  creating.value = true
  issued.value = await mutate(wsApi('/enrollments'), { method: 'POST', body: wizardForm })
  creating.value = false
}
async function finish() {
  wizard.value = false
  issued.value = null
  await refreshTokens()
}
async function revokeToken(id: string) {
  if (await mutate(wsApi(`/enrollments/${id}`), { method: 'DELETE', success: 'Token revoked' })) await refreshTokens()
}
</script>

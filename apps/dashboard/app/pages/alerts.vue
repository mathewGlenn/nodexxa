<template>
  <PagePanel title="Alert rules" icon="i-lucide-bell-ring">
    <template #actions>
      <UButton v-if="can('ADMIN')" icon="i-lucide-plus" data-testid="add-rule" @click="edit(null)">Add rule</UButton>
    </template>
    <p class="mb-4 max-w-3xl text-sm text-muted">
      Rules are evaluated by the worker every ~20 s. A condition must hold for the configured duration before an incident opens (and recover for the same time, capped at 10 min, before it resolves).
      Within the cooldown a recurring condition reopens the previous incident instead of notifying again. Nodexxa never runs repair actions.
    </p>
    <UTable :data="rules ?? []" :columns="columns" data-testid="rules-table">
      <template #name-cell="{ row }">
        <div class="font-medium text-highlighted">{{ row.original.name }}</div>
        <div class="text-xs text-muted">{{ TYPE_LABELS[row.original.type] ?? row.original.type }}</div>
      </template>
      <template #threshold-cell="{ row }">{{ thresholdText(row.original.type, row.original.threshold) }}</template>
      <template #severity-cell="{ row }"><StatusBadge :status="row.original.severity" :label="row.original.severity" /></template>
      <template #enabled-cell="{ row }"><StatusBadge :status="row.original.enabled ? 'ok' : 'disabled'" :label="row.original.enabled ? 'enabled' : 'disabled'" /></template>
      <template #actions-cell="{ row }">
        <div v-if="can('ADMIN')" class="flex gap-1">
          <UButton size="xs" color="neutral" variant="outline" @click="edit(row.original)">Edit</UButton>
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="Delete rule" @click="remove(row.original.id)" />
        </div>
      </template>
    </UTable>

    <section class="mt-10 space-y-3">
      <h2 class="font-medium text-highlighted">Notification channels</h2>
      <div class="flex flex-wrap gap-2 text-sm">
        <StatusBadge :status="channels?.connectors.email ? 'ok' : 'disabled'" :label="channels?.connectors.email ? 'Email (SMTP) configured' : 'Email disabled — SMTP_URL/SMTP_FROM not set'" />
        <StatusBadge :status="channels?.connectors.telegram ? 'ok' : 'disabled'" :label="channels?.connectors.telegram ? 'Telegram configured' : 'Telegram disabled — TELEGRAM_BOT_TOKEN not set'" />
      </div>
      <p class="text-sm text-muted">Incidents are always recorded. Deliveries to an unconfigured connector are marked skipped.</p>
      <UTable :data="channels?.channels ?? []" :columns="channelColumns">
        <template #actions-cell="{ row }">
          <UButton v-if="can('ADMIN')" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="Delete channel" @click="removeChannel(row.original.id)" />
        </template>
        <template #empty><p class="py-4 text-center text-sm text-muted">No channels.</p></template>
      </UTable>
      <UForm v-if="can('ADMIN')" :schema="channelSchema" :state="channelForm" class="flex flex-wrap items-end gap-2" @submit="addChannel">
        <UFormField label="Name" name="name"><UInput v-model="channelForm.name" /></UFormField>
        <UFormField label="Type" name="type"><USelect v-model="channelForm.type" :items="['email', 'telegram']" class="w-32" /></UFormField>
        <UFormField label="Target" name="target" :help="channelForm.type === 'email' ? 'Comma-separated addresses' : 'Chat id or @channel'"><UInput v-model="channelForm.target" class="w-64" /></UFormField>
        <UButton type="submit" color="neutral" variant="outline">Add channel</UButton>
      </UForm>
    </section>

    <UModal v-model:open="open" :title="editing ? 'Edit rule' : 'New rule'">
      <template #body>
        <UForm :schema="alertRuleSchema" :state="form" class="space-y-4" @submit="save">
          <UFormField label="Name" name="name"><UInput v-model="form.name" class="w-full" data-testid="rule-name" /></UFormField>
          <UFormField label="Condition" name="type"><USelect v-model="form.type" :items="typeItems" class="w-full" /></UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Threshold" name="threshold" :help="THRESHOLD_HELP[form.type]"><UInputNumber v-model="form.threshold" :min="0" class="w-full" /></UFormField>
            <UFormField label="Severity" name="severity"><USelect v-model="form.severity" :items="['info', 'warning', 'critical']" class="w-full" /></UFormField>
            <UFormField label="Duration (s)" name="durationSec" :help="form.type === 'pm2_restarts' ? 'Counting window (default 900)' : 'Must hold this long'"><UInputNumber v-model="form.durationSec" :min="0" class="w-full" /></UFormField>
            <UFormField label="Cooldown (s)" name="cooldownSec"><UInputNumber v-model="form.cooldownSec" :min="0" class="w-full" /></UFormField>
          </div>
          <USwitch v-model="form.enabled" label="Enabled" />
          <div class="flex justify-end"><UButton type="submit" data-testid="rule-submit">Save rule</UButton></div>
        </UForm>
      </template>
    </UModal>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can } = useSession()
const { mutate } = useApi()
const { data: rules, refresh } = await useFetch(() => wsApi('/alert-rules'), { key: 'alert-rules' })
const { data: channels, refresh: refreshChannels } = await useFetch(() => wsApi('/channels'), { key: 'channels' })

const TYPE_LABELS: Record<string, string> = {
  agent_offline: 'Agent heartbeat stale', droplet_inactive: 'Droplet not active', pm2_down: 'PM2 process not online', pm2_restarts: 'PM2 restart count',
  docker_unhealthy: 'Container unhealthy / stopped', cpu_high: 'CPU usage', disk_high: 'Disk usage', memory_high: 'Memory usage',
  check_failing: 'HTTP check failing', tls_expiring: 'TLS certificate expiring', do_connection_error: 'DigitalOcean auth / sync failure',
}
const THRESHOLD_HELP: Record<string, string> = {
  agent_offline: 'Seconds without a report', pm2_restarts: 'Restarts in window', cpu_high: 'Percent', disk_high: 'Percent', memory_high: 'Percent',
  check_failing: 'Consecutive failures', tls_expiring: 'Days before expiry',
}
const typeItems = ALERT_TYPES.map(t => ({ label: TYPE_LABELS[t] ?? t, value: t }))
const thresholdText = (type: string, t: number) => (THRESHOLD_HELP[type] ? `${t} (${THRESHOLD_HELP[type]!.toLowerCase()})` : '—')
const columns = [
  { accessorKey: 'name', header: 'Rule' },
  { accessorKey: 'threshold', header: 'Threshold' },
  { accessorKey: 'durationSec', header: 'Duration (s)' },
  { accessorKey: 'cooldownSec', header: 'Cooldown (s)' },
  { accessorKey: 'severity', header: 'Severity' },
  { accessorKey: 'enabled', header: 'State' },
  { accessorKey: 'actions', header: '' },
]
const channelColumns = [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'type', header: 'Type' }, { accessorKey: 'target', header: 'Target' }, { accessorKey: 'actions', header: '' }]

type RuleType = typeof ALERT_TYPES[number]
const blank = () => ({ name: '', type: 'check_failing' as RuleType, severity: 'warning' as 'info' | 'warning' | 'critical', threshold: 2 as number | undefined, durationSec: 0, cooldownSec: 900, enabled: true })
const form = reactive(blank())
const editing = ref<string | null>(null)
const open = ref(false)

function edit(rule: any) {
  editing.value = rule?.id ?? null
  Object.assign(form, rule ? { name: rule.name, type: rule.type, severity: rule.severity, threshold: rule.threshold, durationSec: rule.durationSec, cooldownSec: rule.cooldownSec, enabled: rule.enabled } : blank())
  open.value = true
}
async function save() {
  const res = editing.value
    ? await mutate(wsApi(`/alert-rules/${editing.value}`), { method: 'PUT', body: form, success: 'Rule saved' })
    : await mutate(wsApi('/alert-rules'), { method: 'POST', body: form, success: 'Rule created' })
  if (res) { open.value = false; await refresh() }
}
async function remove(id: string) {
  if (confirm('Delete this rule? Open incidents from it will be resolved.') && await mutate(wsApi(`/alert-rules/${id}`), { method: 'DELETE', success: 'Rule deleted' })) await refresh()
}
const channelForm = reactive({ name: '', type: 'email' as 'email' | 'telegram', target: '', enabled: true })
async function addChannel() {
  if (await mutate(wsApi('/channels'), { method: 'POST', body: channelForm, success: 'Channel added' })) {
    Object.assign(channelForm, { name: '', target: '' })
    await refreshChannels()
  }
}
async function removeChannel(id: string) {
  if (await mutate(wsApi(`/channels/${id}`), { method: 'DELETE', success: 'Channel removed' })) await refreshChannels()
}
</script>

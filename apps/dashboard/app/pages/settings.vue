<template>
  <PagePanel title="Settings" icon="i-lucide-settings">
    <div class="grid max-w-5xl gap-6 lg:grid-cols-2">
      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Appearance</h2></template>
        <p class="mb-3 text-sm text-muted">System follows your operating system. Your choice is saved to your account and this browser.</p>
        <ThemeSelect />
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Profile</h2></template>
        <UForm :state="profile" class="space-y-3" @submit="saveProfile">
          <UFormField label="Name" name="name"><UInput v-model="profile.name" class="w-full" /></UFormField>
          <UFormField label="Email"><UInput :model-value="state?.user?.email" disabled class="w-full" /></UFormField>
          <UButton type="submit" color="neutral" variant="outline">Save</UButton>
        </UForm>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Change password</h2></template>
        <UForm :schema="changePasswordSchema" :state="pw" class="space-y-3" @submit="changePassword">
          <UFormField label="Current password" name="currentPassword"><UInput v-model="pw.currentPassword" type="password" autocomplete="current-password" class="w-full" /></UFormField>
          <UFormField label="New password" name="newPassword" help="At least 12 characters. Signs out other sessions."><UInput v-model="pw.newPassword" type="password" autocomplete="new-password" class="w-full" /></UFormField>
          <UButton type="submit" color="neutral" variant="outline">Change password</UButton>
        </UForm>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium text-highlighted">Workspaces</h2></template>
        <ul class="mb-4 space-y-1 text-sm">
          <li v-for="w in state?.workspaces" :key="w.id" class="flex justify-between"><span>{{ w.name }}</span><span class="text-muted">{{ w.role }}</span></li>
        </ul>
        <UForm v-if="canCreateWorkspace" :schema="workspaceSchema" :state="ws" class="flex items-end gap-2" @submit="createWorkspace">
          <UFormField label="New workspace" name="name"><UInput v-model="ws.name" data-testid="workspace-name" /></UFormField>
          <UButton type="submit" color="neutral" variant="outline" data-testid="workspace-create">Create</UButton>
        </UForm>
      </UCard>

      <UCard class="lg:col-span-2">
        <template #header><h2 class="font-medium text-highlighted">Data retention</h2></template>
        <ul class="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Raw metric samples: 2 days, then downsampled to hourly averages kept 90 days.</li>
          <li>Uptime check results: 30 days. Resolved incidents: 180 days. Audit log: 365 days.</li>
          <li>Resources missing at the provider are kept 30 days before removal.</li>
          <li>Retention runs hourly in the worker; values are configurable via <code>NODEXXA_RETENTION_*</code> environment variables.</li>
        </ul>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { state, refresh, selectWorkspace } = useSession()
const { mutate } = useApi()
const profile = reactive({ name: state.value?.user?.name ?? '' })
const pw = reactive({ currentPassword: '', newPassword: '' })
const ws = reactive({ name: '' })
const canCreateWorkspace = computed(() => state.value?.workspaces.some(w => w.role !== 'VIEWER'))

async function saveProfile() {
  if (await mutate('/api/auth/me', { method: 'PATCH', body: profile, success: 'Profile saved' })) await refresh()
}
async function changePassword() {
  if (await mutate('/api/auth/password', { method: 'POST', body: pw, success: 'Password changed' })) Object.assign(pw, { currentPassword: '', newPassword: '' })
}
async function createWorkspace() {
  const res = await mutate<{ id: string }>('/api/workspaces', { method: 'POST', body: ws, success: 'Workspace created' })
  if (res) {
    ws.name = ''
    await refresh()
    selectWorkspace(res.id)
    await navigateTo('/')
  }
}
</script>

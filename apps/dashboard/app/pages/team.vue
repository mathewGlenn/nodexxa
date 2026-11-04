<template>
  <PagePanel title="Team" icon="i-lucide-users">
    <div class="space-y-8">
      <p class="max-w-3xl text-sm text-muted">
        <strong>Owner</strong>: everything, including managing owners. <strong>Admin</strong>: connections, tokens, agents, checks, alert rules, members.
        <strong>Viewer</strong>: read-only inventory and health, may acknowledge incidents.
      </p>
      <UTable :data="data?.members ?? []" :columns="columns" data-testid="members-table">
        <template #user-cell="{ row }">
          <div class="font-medium text-highlighted">{{ row.original.user.name }}</div>
          <div class="text-xs text-muted">{{ row.original.user.email }}</div>
        </template>
        <template #role-cell="{ row }">
          <USelect
            v-if="can('ADMIN') && row.original.user.id !== state?.user?.id"
            :model-value="row.original.role" :items="roleItems" size="sm" class="w-28" :aria-label="`Role for ${row.original.user.email}`"
            @update:model-value="(role: string) => update(row.original.id, { role })"
          />
          <span v-else>{{ row.original.role }}</span>
        </template>
        <template #status-cell="{ row }"><StatusBadge :status="row.original.disabled ? 'disabled' : 'active'" :label="row.original.disabled ? 'disabled' : 'active'" /></template>
        <template #actions-cell="{ row }">
          <UButton
v-if="can('ADMIN') && row.original.user.id !== state?.user?.id" size="xs" color="neutral" variant="outline"
                   @click="update(row.original.id, { disabled: !row.original.disabled })">{{ row.original.disabled ? 'Enable' : 'Disable' }}</UButton>
        </template>
      </UTable>

      <section v-if="can('ADMIN')" class="space-y-3">
        <h2 class="font-medium text-highlighted">Invite a member</h2>
        <UForm :schema="invitationSchema" :state="invite" class="flex flex-wrap items-end gap-2" @submit="sendInvite">
          <UFormField label="Email" name="email"><UInput v-model="invite.email" type="email" class="w-64" data-testid="invite-email" /></UFormField>
          <UFormField label="Role" name="role"><USelect v-model="invite.role" :items="roleItems" class="w-32" data-testid="invite-role" /></UFormField>
          <UButton type="submit" data-testid="invite-submit">Create invitation</UButton>
        </UForm>
        <UAlert v-if="inviteLink" color="info" variant="subtle" icon="i-lucide-link" title="Share this one-time link securely (valid 72 h)">
          <template #description><code class="break-all" data-testid="invite-link">{{ inviteLink }}</code></template>
        </UAlert>
        <ul v-if="data?.invitations.length" class="divide-y divide-default text-sm">
          <li v-for="i in data.invitations" :key="i.id" class="flex items-center justify-between gap-3 py-2">
            <span>{{ i.email }} · {{ i.role }} · expires {{ fmtDate(i.expiresAt) }}</span>
            <UButton size="xs" color="neutral" variant="ghost" @click="revokeInvite(i.id)">Revoke</UButton>
          </li>
        </ul>
      </section>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi, can, state, workspace } = useSession()
const { mutate } = useApi()
const { data, refresh } = await useFetch(() => wsApi('/members'), { key: 'members' })
const roleItems = computed(() => (workspace.value?.role === 'OWNER' ? ['OWNER', 'ADMIN', 'VIEWER'] : ['ADMIN', 'VIEWER']))
const columns = [{ accessorKey: 'user', header: 'Member' }, { accessorKey: 'role', header: 'Role' }, { accessorKey: 'status', header: 'Status' }, { accessorKey: 'actions', header: 'Actions' }]
const invite = reactive({ email: '', role: 'VIEWER' as 'OWNER' | 'ADMIN' | 'VIEWER' })
const inviteLink = ref('')
const origin = useRequestURL().origin

async function update(id: string, body: object) {
  if (await mutate(wsApi(`/members/${id}`), { method: 'PATCH', body, success: 'Member updated' })) await refresh()
}
async function sendInvite() {
  const res = await mutate<{ path: string }>(wsApi('/invitations'), { method: 'POST', body: invite, success: 'Invitation created' })
  if (res) {
    inviteLink.value = `${origin}${res.path}`
    invite.email = ''
    await refresh()
  }
}
async function revokeInvite(id: string) {
  if (await mutate(wsApi(`/invitations/${id}`), { method: 'DELETE', success: 'Invitation revoked' })) await refresh()
}
</script>

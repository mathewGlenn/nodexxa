<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar collapsible :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted" aria-label="Nodexxa home">
          <UIcon name="i-lucide-radar" class="size-5 text-primary shrink-0" />
          <span v-if="!collapsed">Nodexxa</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <USelect
          v-if="!collapsed && state?.workspaces.length"
          :model-value="workspace?.id"
          :items="state.workspaces.map(w => ({ label: w.name, value: w.id }))"
          icon="i-lucide-building-2"
          aria-label="Workspace"
          data-testid="workspace-select"
          class="w-full"
          @update:model-value="switchWorkspace"
        />
        <UNavigationMenu :collapsed="collapsed" :items="links" orientation="vertical" tooltip />
      </template>

      <template #footer="{ collapsed }">
        <UDropdownMenu :items="userMenu" :content="{ align: 'start' }">
          <UButton
            :label="collapsed ? undefined : state?.user?.name"
            icon="i-lucide-circle-user"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            data-testid="user-menu"
          />
        </UDropdownMenu>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>

<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'

const { state, workspace, selectWorkspace, can } = useSession()

const links = computed<NavigationMenuItem[]>(() => [
  { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Connections', icon: 'i-lucide-plug', to: '/connections' },
  { label: 'Projects', icon: 'i-lucide-folder-tree', to: '/projects' },
  { label: 'Servers', icon: 'i-lucide-server', to: '/servers' },
  { label: 'Applications', icon: 'i-lucide-boxes', to: '/applications' },
  { label: 'Checks', icon: 'i-lucide-activity', to: '/checks' },
  { label: 'Incidents', icon: 'i-lucide-siren', to: '/incidents' },
  { label: 'Alert rules', icon: 'i-lucide-bell-ring', to: '/alerts' },
  { label: 'Agents', icon: 'i-lucide-cpu', to: '/agents' },
  { label: 'Team', icon: 'i-lucide-users', to: '/team' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
  ...(can('ADMIN') ? [{ label: 'Audit log', icon: 'i-lucide-scroll-text', to: '/audit' }] : []),
])

const userMenu = computed<DropdownMenuItem[][]>(() => [
  [{ label: state.value?.user?.email ?? '', type: 'label' }],
  [{ label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: signOut }],
])

async function switchWorkspace(id: string) {
  selectWorkspace(id)
  await navigateTo('/')
  await refreshNuxtData()
}

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  state.value = null
  await navigateTo('/login')
}
</script>

<template>
  <PagePanel title="Projects" icon="i-lucide-folder-tree">
    <p class="mb-4 max-w-3xl text-sm text-muted">DigitalOcean projects group resources inside a team. Membership is read from the provider and a resource may appear in several projects.</p>
    <UEmpty v-if="!data?.length" icon="i-lucide-folder-tree" title="No projects discovered" description="Projects appear after a connection with the project:read scope syncs." />
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <UCard v-for="p in data" :key="p.id" :class="p.missingSince ? 'opacity-70' : ''">
        <template #header>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="font-medium text-highlighted">{{ p.name }} <UBadge v-if="p.isDefault" variant="outline" color="neutral" size="sm">default</UBadge></h2>
              <p class="text-xs text-muted">{{ p.connection.label }}<span v-if="p.connection.client"> · {{ p.connection.client }}</span><span v-if="p.environment"> · {{ p.environment }}</span></p>
            </div>
            <StatusBadge v-if="p.missingSince" status="missing" />
          </div>
        </template>
        <p v-if="p.description" class="mb-3 text-sm text-muted">{{ p.description }}</p>
        <p v-if="!p.resources.length" class="text-sm text-muted">No resources visible to this token.</p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="r in p.resources" :key="r.id" class="flex items-center justify-between gap-2 py-1.5">
            <NuxtLink :to="`/resources/${r.id}`" class="truncate hover:underline">{{ r.name }} <span class="text-xs text-muted">{{ r.type }}</span></NuxtLink>
            <StatusBadge :status="r.missingSince ? 'missing' : r.status" />
          </li>
        </ul>
      </UCard>
    </div>
  </PagePanel>
</template>

<script setup lang="ts">
const { wsApi } = useSession()
const { data } = await useFetch(() => wsApi('/projects'), { key: 'projects' })
</script>

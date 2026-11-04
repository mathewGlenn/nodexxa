<template>
  <div class="space-y-4">
    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="This invitation is invalid or has expired." />
    <template v-else-if="invite">
      <div>
        <h1 class="text-lg font-semibold text-highlighted">Join {{ invite.workspace }}</h1>
        <p class="text-sm text-muted">Invited as <strong>{{ invite.email }}</strong> with the {{ invite.role.toLowerCase() }} role.</p>
      </div>
      <div v-if="invite.userExists" class="space-y-3">
        <p class="text-sm">You already have an account. Sign in as {{ invite.email }}, then accept.</p>
        <UButton v-if="!state?.user" block :to="`/login?next=${encodeURIComponent(route.fullPath)}`">Sign in</UButton>
        <UButton v-else block :loading="loading" @click="accept({})">Accept invitation</UButton>
      </div>
      <UForm v-else :schema="schema" :state="form" class="space-y-4" @submit="accept(form)">
        <UFormField label="Your name" name="name"><UInput v-model="form.name" class="w-full" autocomplete="name" /></UFormField>
        <UFormField label="Password" name="password" help="At least 12 characters">
          <UInput v-model="form.password" type="password" class="w-full" autocomplete="new-password" />
        </UFormField>
        <UButton type="submit" block :loading="loading">Create account</UButton>
      </UForm>
    </template>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Accept invitation' })
const route = useRoute()
const { state, refresh, selectWorkspace } = useSession()
const { mutate } = useApi()
const token = String(route.params.token)
const { data: invite, error } = await useFetch(`/api/invitations/${encodeURIComponent(token)}`)
const schema = z.object({ name: z.string().trim().min(1).max(100), password: passwordSchema })
const form = reactive({ name: '', password: '' })
const loading = ref(false)

async function accept(body: object) {
  loading.value = true
  const res = await mutate<{ workspaceId: string }>(`/api/invitations/${encodeURIComponent(token)}`, { method: 'POST', body, success: 'Invitation accepted' })
  loading.value = false
  if (!res) return
  await refresh()
  selectWorkspace(res.workspaceId)
  await navigateTo('/')
}
</script>

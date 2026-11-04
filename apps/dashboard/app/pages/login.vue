<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">Sign in</h1>
      <p class="text-sm text-muted">Use the account provisioned by your workspace owner.</p>
    </div>
    <UForm :schema="loginSchema" :state="form" class="space-y-4" @submit="submit">
      <UFormField label="Email" name="email">
        <UInput v-model="form.email" type="email" autocomplete="username" class="w-full" data-testid="login-email" />
      </UFormField>
      <UFormField label="Password" name="password">
        <UInput v-model="form.password" type="password" autocomplete="current-password" class="w-full" data-testid="login-password" />
      </UFormField>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" data-testid="login-error" />
      <UButton type="submit" block :loading="loading" data-testid="login-submit">Sign in</UButton>
    </UForm>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in' })

const route = useRoute()
const { refresh } = useSession()
const colorMode = useColorMode()
const form = reactive({ email: '', password: '' })
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ user: { theme: string } }>('/api/auth/login', { method: 'POST', body: form })
    colorMode.preference = res.user.theme
    await refresh()
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('//') ? route.query.next : '/'
    await navigateTo(next)
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Sign-in failed'
  }
  finally {
    loading.value = false
  }
}
</script>

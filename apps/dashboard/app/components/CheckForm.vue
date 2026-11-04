<template>
  <UForm :schema="checkSchema" :state="form" class="space-y-4" @submit="emit('submit', { ...form })">
    <UFormField label="Name" name="name"><UInput v-model="form.name" class="w-full" data-testid="check-name" /></UFormField>
    <UFormField label="URL" name="url" help="Public http(s) endpoints only. Private, loopback, link-local and metadata addresses are refused — also after redirects.">
      <UInput v-model="form.url" placeholder="https://example.com/health" class="w-full" data-testid="check-url" />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Method" name="method"><USelect v-model="form.method" :items="['GET', 'HEAD']" class="w-full" /></UFormField>
      <UFormField label="Interval (s)" name="intervalSec"><UInputNumber v-model="form.intervalSec" :min="30" :max="86400" class="w-full" /></UFormField>
      <UFormField label="Timeout (ms)" name="timeoutMs"><UInputNumber v-model="form.timeoutMs" :min="1000" :max="30000" :step="500" class="w-full" /></UFormField>
      <UFormField label="Expected status" name="expectedStatusMax">
        <div class="flex items-center gap-1">
          <UInputNumber v-model="form.expectedStatusMin" :min="100" :max="599" class="w-full" />–<UInputNumber v-model="form.expectedStatusMax" :min="100" :max="599" class="w-full" />
        </div>
      </UFormField>
    </div>
    <div class="flex flex-wrap gap-6">
      <USwitch v-model="form.followRedirects" label="Follow redirects (max 5)" />
      <USwitch v-model="form.enabled" label="Enabled" />
    </div>
    <div class="flex justify-end gap-2">
      <UButton type="submit" :loading="loading" data-testid="check-submit">Save check</UButton>
    </div>
  </UForm>
</template>

<script setup lang="ts">
type CheckInput = { name: string, url: string, method: 'GET' | 'HEAD', intervalSec: number, timeoutMs: number, followRedirects: boolean, expectedStatusMin: number, expectedStatusMax: number, enabled: boolean }
const props = defineProps<{ initial?: Partial<CheckInput>, loading?: boolean }>()
const emit = defineEmits<{ submit: [CheckInput] }>()
const form = ref<CheckInput>({
  name: '', url: '', method: 'GET', intervalSec: 60, timeoutMs: 10000, followRedirects: true, expectedStatusMin: 200, expectedStatusMax: 399, enabled: true,
  ...props.initial,
})
</script>

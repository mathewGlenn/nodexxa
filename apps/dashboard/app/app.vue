<template>
  <UApp :toaster="{ position: 'bottom-right' }">
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
useHead({
  titleTemplate: t => (t ? `${t} · Nodexxa` : 'Nodexxa'),
  htmlAttrs: { lang: 'en' },
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

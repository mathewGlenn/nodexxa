<template>
  <div class="min-h-dvh flex flex-col items-center justify-center gap-6 bg-default px-4 py-10">
    <div class="flex items-center gap-2 text-lg font-semibold text-highlighted">
      <UIcon name="i-lucide-radar" class="size-6 text-primary" />
      Nodexxa
    </div>
    <UCard class="w-full max-w-sm">
      <slot />
    </UCard>
    <ThemeSelect />
  </div>
</template>

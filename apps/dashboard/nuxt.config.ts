export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,
  // Cookie storage lets SSR render the persisted theme class: no flash, no hydration mismatch.
  colorMode: { preference: 'system', fallback: 'light', storage: 'cookie', storageKey: 'nx-color-mode' },
  ui: { fonts: false },
  typescript: { strict: true },
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    },
  },
  nitro: {
    // Prisma's engine must stay external so Nitro copies it into .output.
    externals: { external: ['@prisma/client', '.prisma/client'] },
  },
  vite: { server: { hmr: { overlay: false } } },
})

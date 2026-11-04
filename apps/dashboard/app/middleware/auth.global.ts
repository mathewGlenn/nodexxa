const PUBLIC = [/^\/login$/, /^\/invite\//]

export default defineNuxtRouteMiddleware(async (to) => {
  const { state, refresh } = useSession()
  if (!state.value) await refresh()
  const isPublic = PUBLIC.some(r => r.test(to.path))
  if (!state.value?.user && !isPublic) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : undefined })
  if (state.value?.user && to.path === '/login') return navigateTo('/')
})

/** Mutation helper: surfaces server error messages as toasts and returns null on failure. */
export function useApi() {
  const toast = useToast()

  async function mutate<T>(url: string, opts: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, success?: string }): Promise<T | null> {
    try {
      const res = await $fetch<T>(url as string, { method: opts.method, body: opts.body as Record<string, unknown> | undefined })
      if (opts.success) toast.add({ title: opts.success, color: 'success', icon: 'i-lucide-check' })
      return res as T
    }
    catch (e: any) {
      const issues: { path: string, message: string }[] | undefined = e?.data?.data?.issues
      toast.add({
        title: e?.data?.statusMessage || e?.statusMessage || 'Request failed',
        description: issues?.map(i => `${i.path}: ${i.message}`).join('; '),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
      return null
    }
  }

  return { mutate }
}

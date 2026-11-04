export interface SessionWorkspace { id: string, name: string, role: 'OWNER' | 'ADMIN' | 'VIEWER' }
export interface SessionState {
  user: { id: string, email: string, name: string, theme: string } | null
  workspaces: SessionWorkspace[]
}

const RANK = { VIEWER: 0, ADMIN: 1, OWNER: 2 } as const

export function useSession() {
  const state = useState<SessionState | null>('session', () => null)
  const wsCookie = useCookie<string | null>('nx-ws', { sameSite: 'lax', maxAge: 31536000 })

  const workspace = computed<SessionWorkspace | null>(() => {
    const list = state.value?.workspaces ?? []
    return list.find(w => w.id === wsCookie.value) ?? list[0] ?? null
  })

  async function refresh() {
    state.value = await useRequestFetch()<SessionState>('/api/auth/me')
  }

  function selectWorkspace(id: string) {
    wsCookie.value = id
  }

  const can = (minRole: keyof typeof RANK) => !!workspace.value && RANK[workspace.value.role] >= RANK[minRole]

  /** Builds a workspace-scoped API path. Membership is enforced server-side on every call. */
  const wsApi = <P extends string>(path: P) => `/api/w/${workspace.value?.id ?? 'none'}${path}` as `/api/w/${string}${P}`

  return { state, workspace, refresh, selectWorkspace, can, wsApi }
}

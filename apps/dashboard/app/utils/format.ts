/** Deterministic (SSR-safe) timestamp formatting in UTC. */
export function fmtDate(value?: string | Date | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function fmtBytes(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

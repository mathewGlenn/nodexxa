import { prisma } from './db'

/** Returns series grouped by metric as [epochMs, value] pairs. Absent data stays absent (no zero fill). */
export async function getSeries(workspaceId: string, seriesKey: string, since: Date) {
  const rows = await prisma.metricSample.findMany({
    where: { workspaceId, seriesKey, ts: { gte: since } },
    orderBy: { ts: 'asc' },
    select: { metric: true, ts: true, value: true, source: true },
    take: 20_000,
  })
  const out: Record<string, { points: [number, number][], source: string }> = {}
  for (const r of rows) (out[r.metric] ??= { points: [], source: r.source }).points.push([r.ts.getTime(), r.value])
  return out
}

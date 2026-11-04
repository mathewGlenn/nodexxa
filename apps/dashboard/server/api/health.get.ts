/** Liveness (process up) and readiness (?ready=1 also checks the database). No internal details are exposed. */
export default defineEventHandler(async (event) => {
  if (getQuery(event).ready === undefined) return { status: 'ok' }
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'ready' }
  }
  catch {
    setResponseStatus(event, 503)
    return { status: 'unavailable' }
  }
})

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { __nxPrisma?: PrismaClient }

export const prisma: PrismaClient = globalForPrisma.__nxPrisma ?? new PrismaClient({ log: ['error'] })
globalForPrisma.__nxPrisma = prisma

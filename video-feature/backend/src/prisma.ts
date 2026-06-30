/**
 * Prisma client singleton for the Mock Interview MVP backend.
 *
 * A single `PrismaClient` instance is shared across routers and middleware to
 * avoid exhausting database connections (especially under hot-reload in dev,
 * where each reload would otherwise spawn a new client).
 */

import { PrismaClient } from '@prisma/client';

// Reuse the client across module reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

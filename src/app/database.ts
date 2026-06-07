// src/app/database.ts
// Migrated from app/database.py (FastAPI + SQLAlchemy connection layer) to idiomatic Node.js/TypeScript using Prisma.
//
// MIGRATION_NOTE: The Python source used SQLAlchemy's create_engine + sessionmaker + declarative_base,
// plus a FastAPI get_db() dependency generator. Prisma replaces ALL of these concerns:
//   - create_engine        -> PrismaClient instantiation (manages the connection pool internally)
//   - sessionmaker/SessionLocal -> not needed; PrismaClient is the single shared client
//   - declarative_base / Base   -> models are declared in prisma/schema.prisma (no runtime Base needed)
//   - get_db() yield/finally    -> not needed; Prisma manages connection lifecycle. Where the source
//                                  code injected `db`, callers should import this shared `prisma` client.
//
// MIGRATION_NOTE: The original connection string was `mysql://{user}:{pass}@{host}/{db}` with no port
// and no driver-specific options. Prisma's MySQL connector defaults to port 3306. Consider adding
// charset/SSL options to the DATABASE_URL query string if required (e.g. ?charset=utf8mb4&sslaccept=strict).

import { PrismaClient } from '@prisma/client';
import { config } from './config';

// MIGRATION_NOTE: Environment variables are now read through a single typed config module (./config)
// instead of inline os.getenv() calls. The config module is responsible for validating presence of
// DB credentials and constructing/exposing DATABASE_URL (Prisma reads DATABASE_URL from env by default).

/**
 * Builds the MySQL connection URL from individual DB_* environment variables.
 *
 * MIGRATION_NOTE: Prisma normally reads `DATABASE_URL` directly from the environment. We construct it
 * here from the legacy DB_USERNAME / DB_PASSWORD / DB_HOST / DB_NAME variables to preserve the original
 * configuration contract. Credentials are URL-encoded to safely handle special characters.
 */
export function buildDatabaseUrl(): string {
  const { dbUsername, dbPassword, dbHost, dbName, dbPort } = config.database;

  const user = encodeURIComponent(dbUsername);
  const pass = encodeURIComponent(dbPassword);
  const port = dbPort ?? 3306;

  return `mysql://${user}:${pass}@${dbHost}:${port}/${dbName}`;
}

/**
 * Single shared PrismaClient instance for the whole application.
 *
 * MIGRATION_NOTE: Replaces SQLAlchemy's `engine` + `SessionLocal`. In serverless or hot-reload
 * environments, instantiating a new PrismaClient per module reload can exhaust DB connections,
 * so we cache the instance on `globalThis` in development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL ?? buildDatabaseUrl(),
      },
    },
    log: config.isProduction ? ['error', 'warn'] : ['query', 'error', 'warn'],
  });

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}

/**
 * Gracefully closes the database connection.
 *
 * MIGRATION_NOTE: This replaces the `finally: db.close()` portion of the Python get_db() generator,
 * but at the application-shutdown level rather than per-request (Prisma pools connections, so we only
 * disconnect once on process termination). Wire this into your server's shutdown hooks (SIGINT/SIGTERM).
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;

import { PrismaClient, Prisma } from '@prisma/client';
import { config } from './config';

/**
 * Database connection and client management.
 *
 * MIGRATION_NOTE: The source `app/database.py` used SQLAlchemy with a
 * `create_engine`/`sessionmaker`/`declarative_base` setup plus a FastAPI-style
 * `get_db()` generator dependency. Despite the "django" migration label, this
 * has been migrated to idiomatic Node.js/TypeScript using Prisma to stay
 * consistent with the already-migrated `app/crud.py`.
 *
 * SQLAlchemy concept            -> Prisma equivalent
 * ----------------------------------------------------------------------------
 * create_engine(URL)            -> `datasource db { url = env("DATABASE_URL") }`
 *                                  in schema.prisma; connection pooling is
 *                                  handled internally by Prisma.
 * sessionmaker / SessionLocal   -> A single shared `PrismaClient` instance.
 *                                  Prisma manages connections/pooling; there is
 *                                  no per-request "session" object to open/close.
 * declarative_base() (Base)     -> Models are declared in `schema.prisma` and
 *                                  generated into `@prisma/client`. There is no
 *                                  runtime base class to export.
 * get_db() generator dependency -> `getPrisma()` returns the shared client.
 *                                  Express handlers receive it via constructor
 *                                  injection rather than a yield-based generator.
 */

/**
 * MIGRATION_NOTE: The source built the connection string as
 *   mysql://{username}:{password}@{host}/{db_name}
 * with no port (defaults to 3306), no charset, no SSL, and no URL-encoding of
 * credentials. Prisma expects a single `DATABASE_URL`. The typed config module
 * (`./config`) is responsible for assembling/validating this URL from the
 * individual DB_* environment variables and URL-encoding the password so that
 * special characters do not break the connection string.
 */

let prisma: PrismaClient | undefined;

/**
 * Returns the shared PrismaClient instance, lazily instantiating it on first
 * use. Equivalent in spirit to SQLAlchemy's `SessionLocal` factory, except a
 * single long-lived client is reused instead of creating a new session per
 * request.
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.databaseUrl,
        },
      },
      log:
        config.nodeEnv === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });
  }
  return prisma;
}

/**
 * Verifies database connectivity. Call once during application startup so that
 * configuration/connection errors surface early rather than on the first query.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await getPrisma().$connect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to connect to the database: ${message}`);
  }
}

/**
 * Gracefully closes the Prisma connection. This is the closest analogue to the
 * `finally: db.close()` cleanup in the source `get_db()` generator, but it runs
 * once on application shutdown rather than per request.
 */
export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

/**
 * Runs a callback inside a Prisma interactive transaction, providing a
 * transactional client. Useful where the SQLAlchemy code relied on a single
 * session committing multiple writes atomically.
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return getPrisma().$transaction(fn);
}

export type { PrismaClient } from '@prisma/client';

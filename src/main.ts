import express, { Application, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { generateDemoData } from './utils/dataGenerator';

// Router factories from the already-migrated endpoint modules.
// MIGRATION_NOTE: In the FastAPI source, routers were `APIRouter` instances
// imported and registered via `app.include_router(...)`. The migrated Express
// endpoint modules export factory functions that accept an injected
// `PrismaClient` (per the dependency-injection convention established in
// `app/endpoints/*.ts`). We therefore call each factory with the shared
// Prisma client instead of importing a pre-built singleton router.
import { createProductsRouter } from './endpoints/products';
import { createSalesRouter } from './endpoints/sales';
import { createInventoryRouter } from './endpoints/inventory';
import { createAnalyticsRouter } from './endpoints/analytics';

/**
 * Application entry point for the E-commerce Admin API.
 *
 * MIGRATION_NOTE: The source was a FastAPI application (`main.py`) that:
 *   1. Instantiated a `FastAPI` app with title/description/version metadata.
 *   2. Registered four `APIRouter`s (products, sales, inventory, analytics).
 *   3. Ran a `@app.on_event("startup")` async hook that:
 *        a. Created all DB tables via `Base.metadata.create_all(bind=engine)`.
 *        b. Opened a SQLAlchemy session and called `generate_demo_data(db)`.
 *
 * This has been migrated to an Express application bootstrapped with a shared
 * Prisma client.
 *
 * MIGRATION_NOTE: `Base.metadata.create_all(bind=engine)` has NO runtime
 * equivalent here. With Prisma, schema management is handled out-of-band via
 * `prisma migrate deploy` / `prisma migrate dev` (or `prisma db push`), NOT at
 * application startup. The table-creation call has been removed; ensure
 * migrations are applied as part of deployment.
 *
 * MIGRATION_NOTE: The explicit `SessionLocal()` / `db.close()` lifecycle is
 * unnecessary with Prisma, which manages its own connection pool. Seeding now
 * uses the shared client directly.
 *
 * MIGRATION_NOTE: Running demo-data seeding on every startup (as the FastAPI
 * `on_event("startup")` hook did) is preserved here for behavioral parity, but
 * is gated behind `config.seedDemoData` so it can be disabled in production.
 * Consider moving this to a dedicated seed script (e.g. `npm run seed`)
 * instead of an application-startup side effect. REQUIRES MANUAL REVIEW.
 */

export function createApp(prisma: PrismaClient): Application {
  const app = express();

  app.use(express.json());

  // Register resource routers (equivalent to FastAPI's include_router calls).
  app.use(createProductsRouter(prisma));
  app.use(createSalesRouter(prisma));
  app.use(createInventoryRouter(prisma));
  app.use(createAnalyticsRouter(prisma));

  // Centralized error-handling middleware. Returns a consistent JSON shape.
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      logger.error('Unhandled request error', { err });
      const message =
        err instanceof Error ? err.message : 'Internal Server Error';
      res.status(500).json({ error: message });
    },
  );

  return app;
}

/**
 * Startup routine: mirrors the FastAPI `startup_event` hook.
 *
 * MIGRATION_NOTE: Table creation removed (handled by Prisma migrations).
 * Demo-data seeding preserved but optional.
 */
async function runStartupSeed(prisma: PrismaClient): Promise<void> {
  if (!config.seedDemoData) {
    logger.info('Demo data seeding disabled (config.seedDemoData=false)');
    return;
  }

  try {
    logger.info('Seeding demo data...');
    await generateDemoData(prisma);
    logger.info('Demo data seeding complete');
  } catch (err) {
    // Preserve the source's try/finally intent: failures are surfaced, not
    // swallowed. We log and rethrow so bootstrap can decide whether to abort.
    logger.error('Demo data seeding failed', { err });
    throw err;
  }
}

async function bootstrap(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    await runStartupSeed(prisma);

    const app = createApp(prisma);

    const server = app.listen(config.port, () => {
      logger.info(`E-commerce Admin API listening on port ${config.port}`);
    });

    // Graceful shutdown: disconnect Prisma on termination signals.
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down...`);
      server.close();
      await prisma.$disconnect();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start application', { err });
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Only auto-bootstrap when executed directly (not when imported in tests).
if (require.main === module) {
  void bootstrap();
}

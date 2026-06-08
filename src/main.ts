// src/main.ts
// Migrated from main.py (FastAPI E-commerce Admin API entry point) to idiomatic
// Node.js/TypeScript using Express.
//
// MIGRATION_NOTE: FastAPI's `app = FastAPI(title=..., description=..., version=...)` has no
// direct Express equivalent for metadata. The title/description/version are preserved as
// constants and surfaced via a small `/` info route (and would feed an OpenAPI/Swagger doc
// generator if one is added later).
//
// MIGRATION_NOTE: `app.include_router(...)` becomes `app.use('/prefix', router)` in Express.
// Each router module (products, sales, inventory, analytics) is mounted here. The path
// prefixes are assumed; verify they match the prefixes declared inside each FastAPI router
// (FastAPI routers may declare their own `prefix=` which we cannot see from this file).
//
// MIGRATION_NOTE: FastAPI's `@app.on_event('startup')` lifecycle hook is migrated to an
// explicit async `bootstrap()` function invoked before the HTTP server starts listening.
//
// MIGRATION_NOTE: `Base.metadata.create_all(bind=engine)` auto-creates tables at runtime.
// This is an anti-pattern in the Node/Prisma world. With Prisma, schema is managed via
// `prisma migrate deploy` / `prisma migrate dev` as a deploy step, NOT at app startup.
// We therefore DO NOT recreate tables here. Ensure migrations are applied during deploy.
//
// MIGRATION_NOTE: `generate_demo_data(db)` previously received a SQLAlchemy session.
// Prisma manages connections internally, so no session is passed. Seeding on EVERY startup
// is generally undesirable; here it is guarded by the SEED_DEMO_DATA env flag and assumes
// generateDemoData is idempotent. Prefer running this as a one-off seed script
// (e.g. `prisma db seed`) rather than in the request-serving process.

import express, { Express, Request, Response, NextFunction } from 'express';

import { config } from './config';
import { prisma } from './app/database';
import { logger } from './app/logger';

import productsRouter from './app/endpoints/products';
import salesRouter from './app/endpoints/sales';
import inventoryRouter from './app/endpoints/inventory';
import analyticsRouter from './app/endpoints/analytics';

import { generateDemoData } from './app/utils/dataGenerator';

export const API_INFO = {
  title: 'E-commerce Admin API',
  description: 'API for managing e-commerce admin dashboard',
  version: '1.0.0',
} as const;

/**
 * Builds and configures the Express application (no side effects on the network).
 * Exported separately so integration tests can import the app and use supertest
 * without starting a real server.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Lightweight info route exposing the metadata that FastAPI carried on the app object.
  app.get('/', (_req: Request, res: Response) => {
    res.json(API_INFO);
  });

  // Register routers (equivalent to FastAPI's app.include_router calls).
  // MIGRATION_NOTE: Verify these path prefixes against each router's internal routing.
  app.use('/products', productsRouter);
  app.use('/sales', salesRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/analytics', analyticsRouter);

  // 404 handler for unmatched routes.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Centralized error-handling middleware.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    logger.error('Unhandled request error', { error: message });
    res.status(500).json({ error: 'Internal Server Error', details: message });
  });

  return app;
}

/**
 * Startup tasks that ran inside FastAPI's @app.on_event('startup').
 *
 * MIGRATION_NOTE: Table creation (Base.metadata.create_all) is intentionally omitted in favor
 * of Prisma migrations applied at deploy time. Only optional demo-data seeding remains.
 */
async function bootstrap(): Promise<void> {
  if (config.seedDemoData) {
    logger.info('SEED_DEMO_DATA enabled — generating demo data');
    try {
      await generateDemoData(prisma);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to generate demo data', { error: message });
      throw err;
    }
  } else {
    logger.info('SEED_DEMO_DATA disabled — skipping demo data generation');
  }
}

/**
 * Application entrypoint: run startup tasks, then begin listening.
 * Guarded so that importing this module (e.g. in tests) does not start the server.
 */
async function main(): Promise<void> {
  await bootstrap();

  const app = createApp();

  app.listen(config.port, () => {
    logger.info(`${API_INFO.title} v${API_INFO.version} listening on port ${config.port}`);
  });
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Fatal error during startup', { error: message });
    process.exit(1);
  });
}

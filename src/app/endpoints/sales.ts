import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { createSale, getSales, calculatePeriodicRevenue } from '../crud';

/**
 * Sales endpoints: record a sale, list/filter sales, and compute periodic
 * revenue analytics (daily, weekly, monthly, annual) with optional comparison
 * against the previous period.
 *
 * MIGRATION_NOTE: The source was a FastAPI APIRouter using SQLAlchemy with a
 * `Depends(get_db)` session and Pydantic `response_model` serialization.
 * Consistent with the already-migrated `app/crud.ts`, `app/database.ts`, and
 * `app/endpoints/*.ts`, this has been migrated to an Express Router using
 * Prisma. The DB client is injected via the factory function below rather than
 * per-request dependency injection.
 *
 * MIGRATION_NOTE: FastAPI's `HTTPException` was imported in the source but never
 * used, so it has no equivalent here.
 *
 * MIGRATION_NOTE: Pydantic schemas (`schemas.Sale`, `schemas.SaleCreate`) that
 * defined the request/response contract are mapped to Zod schemas below for
 * input validation. Output shaping is delegated to whatever `crud` returns,
 * matching the source's thin-endpoint design.
 */

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * MIGRATION_NOTE: `schemas.SaleCreate` fields are not visible in this source
 * file. The shape below is a best-effort contract derived from typical sales
 * records and the filters used in `read_sales` (product_id, category implied
 * via product). Review against `app/schemas.py` / the migrated crud module to
 * ensure field names and required/optional flags match exactly.
 */
const saleCreateSchema = z
  .object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative().optional(),
    saleDate: z.coerce.date().optional(),
  })
  .passthrough();

// A flexible date coercion that accepts ISO date strings (YYYY-MM-DD) or
// full ISO datetimes, mirroring FastAPI's `date` query binding.
const optionalDate = z.coerce.date().optional();

const readSalesQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).default(100),
  startDate: optionalDate,
  endDate: optionalDate,
  productId: z.coerce.number().int().positive().optional(),
  category: z.string().min(1).optional(),
});

// MIGRATION_NOTE: The source accepted a free-form `period` string. Per the
// migration notes, this is validated against an explicit enum to reject
// invalid values up front.
const periodEnum = z.enum(['daily', 'weekly', 'monthly', 'annual']);

const periodicRevenueQuerySchema = z
  .object({
    period: periodEnum,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    compareWithPrevious: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['startDate'],
  });

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates the sales router with an injected Prisma client.
 *
 * @param prisma - The Prisma client used by the crud layer.
 */
export function createSalesRouter(prisma: PrismaClient): Router {
  const router = Router();

  // POST /sales/ — record a sale
  router.post(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = saleCreateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Invalid sale payload',
            details: parsed.error.flatten(),
          });
          return;
        }

        const sale = await createSale(prisma, parsed.data);
        res.status(201).json(sale);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /sales/ — list/filter sales
  router.get(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = readSalesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Invalid query parameters',
            details: parsed.error.flatten(),
          });
          return;
        }

        const { skip, limit, startDate, endDate, productId, category } =
          parsed.data;

        const sales = await getSales(prisma, {
          skip,
          limit,
          startDate,
          endDate,
          productId,
          category,
        });

        res.status(200).json(sales);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /sales/revenue/periodic — periodic revenue analytics
  router.get(
    '/revenue/periodic',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = periodicRevenueQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Invalid query parameters',
            details: parsed.error.flatten(),
          });
          return;
        }

        const { period, startDate, endDate, compareWithPrevious } = parsed.data;

        const revenue = await calculatePeriodicRevenue(prisma, {
          period,
          startDate,
          endDate,
          compareWithPrevious,
        });

        res.status(200).json(revenue);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export default createSalesRouter;

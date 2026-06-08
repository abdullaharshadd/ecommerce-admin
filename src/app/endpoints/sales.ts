// src/app/endpoints/sales.ts
// Migrated from app/endpoints/sales.py (FastAPI sales router) to idiomatic
// Node.js/TypeScript using Express + Zod for validation.
//
// MIGRATION_NOTE: FastAPI's `Depends(get_db)` injection is dropped. As established in the
// already-migrated database.ts/crud.ts, Prisma manages connections internally; the crud
// functions use the shared Prisma client directly rather than receiving a `db` session.
//
// MIGRATION_NOTE: FastAPI's `response_model=schemas.Sale` / `List[schemas.Sale]` performed
// automatic Pydantic serialization. Here, crud functions are assumed to return plain objects
// matching the Sale shape; we serialize via res.json() directly. If field shaping is required,
// add explicit DTO mappers.
//
// MIGRATION_NOTE: FastAPI query-param type coercion (int/date/bool) is reproduced with Zod
// coercion schemas. Invalid params yield a 422-equivalent 400 error with details, matching
// FastAPI's validation behavior.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crud from '../crud';

export const salesRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

// Body schema for recording a sale (schemas.SaleCreate).
// MIGRATION_NOTE: The exact fields of SaleCreate live in the source Pydantic model.
// Replace this passthrough object with the concrete fields once schemas.py is inspected.
const saleCreateSchema = z.object({}).passthrough();

// Query schema for listing sales.
const readSalesQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(0).default(100),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  product_id: z.coerce.number().int().optional(),
  category: z.string().optional(),
});

// period is an untyped str in the source restricted to these values by convention.
const periodEnum = z.enum(['daily', 'weekly', 'monthly', 'annual']);

// Query schema for periodic revenue. start_date/end_date are required.
const periodicRevenueQuerySchema = z.object({
  period: periodEnum,
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  // FastAPI parses bool from common truthy strings; reproduce that leniency.
  compare_with_previous: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /sales/  -> record_sale
salesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = saleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const sale = await crud.createSale(parsed.data);
    return res.status(201).json(sale);
  } catch (err) {
    return next(err);
  }
});

// GET /sales/  -> read_sales
salesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = readSalesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }

    const { skip, limit, start_date, end_date, product_id, category } = parsed.data;

    const sales = await crud.getSales({
      skip,
      limit,
      startDate: start_date,
      endDate: end_date,
      productId: product_id,
      category,
    });

    return res.json(sales);
  } catch (err) {
    return next(err);
  }
});

// GET /sales/revenue/periodic  -> get_periodic_revenue
// MIGRATION_NOTE: The source endpoint has no response_model; the response shape is defined
// entirely by crud.calculate_periodic_revenue. Whatever it returns is serialized as-is.
salesRouter.get('/revenue/periodic', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = periodicRevenueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }

    const { period, start_date, end_date, compare_with_previous } = parsed.data;

    const revenue = await crud.calculatePeriodicRevenue({
      period,
      startDate: start_date,
      endDate: end_date,
      compareWithPrevious: compare_with_previous,
    });

    return res.json(revenue);
  } catch (err) {
    return next(err);
  }
});

export default salesRouter;

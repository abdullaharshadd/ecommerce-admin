// src/app/endpoints/inventory.ts
// Migrated from app/endpoints/inventory.py (FastAPI inventory router) to idiomatic
// Node.js/TypeScript using Express + Zod for validation.
//
// MIGRATION_NOTE: FastAPI's `Depends(get_db)` injection is dropped. As established in the
// already-migrated database.ts/crud.ts, Prisma manages connections internally; the crud
// functions use the shared Prisma client directly rather than receiving a `db` session.
//
// MIGRATION_NOTE: FastAPI's `response_model` performed automatic Pydantic serialization.
// Here, crud functions are assumed to return plain objects matching the Inventory /
// InventoryHistory shapes; we serialize via res.json() directly. If field shaping is
// required, add explicit DTO mappers.
//
// MIGRATION_NOTE: The source `HTTPException` import was unused and has been omitted.
// crud.update_inventory is assumed to handle the not-found case internally; we surface
// any thrown error through the centralized Express error middleware via next(err).

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crud from '../crud';

export const inventoryRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

// MIGRATION_NOTE: Query params arrive as strings; we coerce explicitly.
// FastAPI defaults preserved: low_stock_only=false, skip=0, limit=100, days=30.
const listInventoryQuerySchema = z.object({
  low_stock_only: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  skip: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).optional().default(100),
});

const productIdParamSchema = z.object({
  product_id: z.coerce.number().int(),
});

const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).optional().default(30),
});

// MIGRATION_NOTE: This mirrors the Pydantic `schemas.InventoryUpdate` contract.
// Adjust fields to match the actual InventoryUpdate schema in the source project.
const inventoryUpdateSchema = z
  .object({
    quantity: z.number().int().optional(),
    reorder_level: z.number().int().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /inventory/
// Lists inventory, optionally filtered to low-stock items, with offset pagination.
inventoryRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = listInventoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }
    const { low_stock_only, skip, limit } = parsed.data;

    const result = low_stock_only
      ? await crud.getLowStockItems({ skip, limit })
      : await crud.getInventory({ skip, limit });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// PUT /inventory/:product_id/update
// Updates inventory for a product. Not-found handling is assumed inside crud.updateInventory.
inventoryRouter.put('/:product_id/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = productIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: 'Invalid product_id', details: params.error.flatten() });
    }

    const body = inventoryUpdateSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request body', details: body.error.flatten() });
    }

    const updated = await crud.updateInventory({
      productId: params.data.product_id,
      inventoryUpdate: body.data,
    });

    return res.json(updated);
  } catch (err) {
    return next(err);
  }
});

// GET /inventory/history/:product_id
// Retrieves inventory history over a configurable day window (default 30).
inventoryRouter.get('/history/:product_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = productIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: 'Invalid product_id', details: params.error.flatten() });
    }

    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: query.error.flatten() });
    }

    const history = await crud.getInventoryHistory({
      productId: params.data.product_id,
      days: query.data.days,
    });

    return res.json(history);
  } catch (err) {
    return next(err);
  }
});

export default inventoryRouter;

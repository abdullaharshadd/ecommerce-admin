import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  getInventory,
  getLowStockItems,
  updateInventory,
  getInventoryHistory,
} from '../crud';

/**
 * Inventory management endpoints: listing inventory (with optional low-stock
 * filtering and pagination), updating inventory for a product, and retrieving
 * inventory history.
 *
 * MIGRATION_NOTE: The source was a FastAPI APIRouter using SQLAlchemy with a
 * `Depends(get_db)` session. Consistent with the already-migrated `app/crud.ts`,
 * `app/database.ts`, and `app/endpoints/analytics.ts`, this has been migrated to
 * an Express Router using Prisma. The DB client is injected via the factory
 * function below rather than per-request dependency injection.
 *
 * MIGRATION_NOTE: FastAPI's `response_model` (schemas.Inventory,
 * schemas.InventoryHistory) handled serialization automatically. In Express we
 * return the CRUD results directly as JSON; the Prisma model shapes are assumed
 * to match the previous Pydantic schemas. If the API contract requires field
 * filtering/renaming, add an explicit serialization step here.
 *
 * MIGRATION_NOTE: `HTTPException` was imported but unused in the source, and no
 * authentication/permission logic was present. Verify whether auth is applied
 * globally elsewhere; none is added here.
 *
 * MIGRATION_NOTE: The `models` import in the source was unused for routing.
 */

// --------------------------------
// Request validation schemas
// --------------------------------

/**
 * Query parameters for listing inventory.
 * Mirrors FastAPI defaults: low_stock_only=false, skip=0, limit=100.
 */
const listInventoryQuerySchema = z.object({
  low_stock_only: z
    .preprocess(
      (val) => (val === undefined ? false : val === 'true' || val === true),
      z.boolean(),
    )
    .default(false),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(0).default(100),
});

/**
 * Path parameter schema for endpoints keyed on product_id.
 */
const productIdParamsSchema = z.object({
  product_id: z.coerce.number().int(),
});

/**
 * Request body schema for updating inventory.
 *
 * MIGRATION_NOTE: This corresponds to the source `schemas.InventoryUpdate`
 * Pydantic model. The exact field set must be confirmed against the original
 * schema definition during manual review. A common shape (quantity delta or
 * absolute value plus optional reason) is assumed below.
 */
const inventoryUpdateSchema = z.object({
  quantity: z.number().int(),
  reason: z.string().optional(),
});

/**
 * Query parameters for inventory history.
 * Mirrors FastAPI default: days=30.
 */
const inventoryHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(0).default(30),
});

/**
 * Factory that builds the inventory router with an injected PrismaClient.
 */
export function createInventoryRouter(prisma: PrismaClient): Router {
  const router = Router();

  // GET /inventory/ — list inventory, optionally low-stock only.
  router.get(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = listInventoryQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid query parameters',
            details: parsed.error.flatten(),
          });
          return;
        }

        const { low_stock_only, skip, limit } = parsed.data;

        const result = low_stock_only
          ? await getLowStockItems(prisma, { skip, limit })
          : await getInventory(prisma, { skip, limit });

        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /inventory/:product_id/update — update inventory for a product.
  router.put(
    '/:product_id/update',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const params = productIdParamsSchema.safeParse(req.params);
        if (!params.success) {
          res.status(400).json({
            error: 'Invalid path parameters',
            details: params.error.flatten(),
          });
          return;
        }

        const body = inventoryUpdateSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({
            error: 'Invalid request body',
            details: body.error.flatten(),
          });
          return;
        }

        const updated = await updateInventory(prisma, {
          productId: params.data.product_id,
          inventoryUpdate: body.data,
        });

        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /inventory/history/:product_id — retrieve inventory history.
  router.get(
    '/history/:product_id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const params = productIdParamsSchema.safeParse(req.params);
        if (!params.success) {
          res.status(400).json({
            error: 'Invalid path parameters',
            details: params.error.flatten(),
          });
          return;
        }

        const query = inventoryHistoryQuerySchema.safeParse(req.query);
        if (!query.success) {
          res.status(400).json({
            error: 'Invalid query parameters',
            details: query.error.flatten(),
          });
          return;
        }

        const history = await getInventoryHistory(prisma, {
          productId: params.data.product_id,
          days: query.data.days,
        });

        res.status(200).json(history);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export default createInventoryRouter;

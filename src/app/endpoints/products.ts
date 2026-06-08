import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
} from '../crud';

/**
 * Product CRUD endpoints: create, list (with pagination), read by id, and
 * update.
 *
 * MIGRATION_NOTE: The source was a FastAPI APIRouter using SQLAlchemy with a
 * `Depends(get_db)` session and Pydantic `response_model` serialization.
 * Consistent with the already-migrated `app/crud.ts`, `app/database.ts`,
 * `app/endpoints/analytics.ts`, and `app/endpoints/inventory.ts`, this has been
 * migrated to an Express Router using Prisma. The DB client is injected via the
 * factory function below rather than per-request dependency injection.
 *
 * MIGRATION_NOTE: Pydantic schemas (ProductCreate, ProductUpdate) are mapped to
 * Zod schemas for request validation. The `response_model=schemas.Product`
 * serialization is approximated by returning the CRUD layer result directly;
 * if the source `schemas.Product` filtered/transformed fields, replicate that
 * shaping in the CRUD layer or here.
 */

// MIGRATION_NOTE: Mirrors Pydantic `ProductCreate`. Field names/types should be
// reconciled with `app/schemas.py` if it differs.
const productCreateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.number(),
  sku: z.string().optional(),
});

// MIGRATION_NOTE: Mirrors Pydantic `ProductUpdate`. All fields optional to allow
// partial updates; reconcile with `app/schemas.py`.
const productUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.number().optional(),
  sku: z.string().optional(),
});

// Query params for the list endpoint. Mirrors FastAPI defaults skip=0, limit=100.
const listQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).default(100),
});

const productIdParamSchema = z.object({
  product_id: z.coerce.number().int(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/**
 * Factory that builds the products router with an injected Prisma client.
 */
export function createProductsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // POST /products/ -> create_product
  router.post(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = productCreateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Validation failed',
            details: parsed.error.flatten(),
          });
          return;
        }

        const product = await createProduct(prisma, parsed.data);
        res.status(201).json(product);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /products/ -> read_products
  router.get(
    '/',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = listQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Validation failed',
            details: parsed.error.flatten(),
          });
          return;
        }

        const { skip, limit } = parsed.data;
        const products = await getProducts(prisma, skip, limit);
        res.status(200).json(products);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /products/:product_id -> read_product
  router.get(
    '/:product_id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = productIdParamSchema.safeParse(req.params);
        if (!parsed.success) {
          res.status(422).json({
            error: 'Validation failed',
            details: parsed.error.flatten(),
          });
          return;
        }

        const product = await getProduct(prisma, parsed.data.product_id);
        if (product === null || product === undefined) {
          // Preserves the source's 404 "Product not found" behavior.
          res.status(404).json({ error: 'Product not found' });
          return;
        }

        res.status(200).json(product);
      } catch (err) {
        next(err);
      }
    },
  );

  // PUT /products/:product_id -> update_product
  router.put(
    '/:product_id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const paramParsed = productIdParamSchema.safeParse(req.params);
        if (!paramParsed.success) {
          res.status(422).json({
            error: 'Validation failed',
            details: paramParsed.error.flatten(),
          });
          return;
        }

        const bodyParsed = productUpdateSchema.safeParse(req.body);
        if (!bodyParsed.success) {
          res.status(422).json({
            error: 'Validation failed',
            details: bodyParsed.error.flatten(),
          });
          return;
        }

        // MIGRATION_NOTE: The source `update_product` endpoint does NOT perform an
        // explicit existence/404 check; it delegates entirely to
        // `crud.update_product`. This behavior is preserved here. If
        // `updateProduct` throws when the product is missing (e.g. Prisma
        // P2025), that error propagates to the centralized error middleware.
        // Verify the CRUD layer behavior matches the original SQLAlchemy logic.
        const updated = await updateProduct(
          prisma,
          paramParsed.data.product_id,
          bodyParsed.data,
        );
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export default createProductsRouter;

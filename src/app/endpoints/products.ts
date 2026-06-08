// src/app/endpoints/products.ts
// Migrated from app/endpoints/products.py (FastAPI products router) to idiomatic
// Node.js/TypeScript using Express + Zod for validation.
//
// MIGRATION_NOTE: FastAPI's `Depends(get_db)` injection is dropped. As established in the
// already-migrated database.ts/crud.ts, Prisma manages connections internally; the crud
// functions use the shared Prisma client directly rather than receiving a `db` session.
//
// MIGRATION_NOTE: FastAPI's `response_model=schemas.Product` performed automatic Pydantic
// serialization. Here, crud functions are assumed to return plain objects matching the
// Product shape; we serialize via res.json() directly. If field shaping is required, add
// explicit DTO mappers.
//
// MIGRATION_NOTE: FastAPI's type-hint-based request parsing (product_id: int, skip/limit
// query params) is replaced with explicit Zod validation of params and query strings.
//
// MIGRATION_NOTE: The source `update_product` did NOT check for a missing product before
// updating (unlike `read_product`). To preserve business logic EXACTLY, we do not add a
// 404 here. If the crud.updateProduct layer throws on a missing record (e.g. Prisma's
// P2025), that error propagates to the centralized error middleware. Consider adding an
// explicit 404 for consistency — see notes / requires_manual_review.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as crud from '../crud';

export const productsRouter = Router();

// --- Validation schemas ---------------------------------------------------

// MIGRATION_NOTE: schemas.ProductCreate / ProductUpdate (Pydantic) become Zod schemas.
// Field definitions below are placeholders matching the assumed Product shape; adjust to
// match the real app/schemas.py definitions during review.
const productCreateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.number(),
  sku: z.string().optional(),
});

const productUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.number().optional(),
  sku: z.string().optional(),
});

const productIdParamSchema = z.object({
  product_id: z.coerce.number().int(),
});

const listQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(0).default(100),
});

// --- Routes ---------------------------------------------------------------

// POST /products/
productsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const product = productCreateSchema.parse(req.body);
      const created = await crud.createProduct(product);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(422).json({ error: 'Validation failed', details: err.flatten() });
        return;
      }
      next(err);
    }
  },
);

// GET /products/
productsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { skip, limit } = listQuerySchema.parse(req.query);
      const products = await crud.getProducts({ skip, limit });
      res.json(products);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(422).json({ error: 'Validation failed', details: err.flatten() });
        return;
      }
      next(err);
    }
  },
);

// GET /products/:product_id
productsRouter.get(
  '/:product_id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { product_id } = productIdParamSchema.parse(req.params);
      const product = await crud.getProduct(product_id);
      if (product === null || product === undefined) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(422).json({ error: 'Validation failed', details: err.flatten() });
        return;
      }
      next(err);
    }
  },
);

// PUT /products/:product_id
productsRouter.put(
  '/:product_id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { product_id } = productIdParamSchema.parse(req.params);
      const product = productUpdateSchema.parse(req.body);
      // MIGRATION_NOTE: No pre-update 404 check, matching the source exactly.
      const updated = await crud.updateProduct(product_id, product);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(422).json({ error: 'Validation failed', details: err.flatten() });
        return;
      }
      next(err);
    }
  },
);

export default productsRouter;

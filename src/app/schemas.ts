// src/app/schemas.ts
// Migrated from app/schemas.py (Pydantic v1 schemas for the product/inventory/sales/
// revenue domain) to idiomatic Node.js/TypeScript using Zod for runtime validation plus
// inferred TypeScript types for compile-time typing.
//
// MIGRATION_NOTE: Pydantic models serve two roles that we split here:
//   1. Runtime validation of incoming request bodies  -> Zod schemas (exported as *Schema).
//   2. Static typing of objects passed around the app  -> TypeScript types inferred via
//      z.infer<typeof Schema> (exported with the same name as the Pydantic class).
//
// MIGRATION_NOTE: Decimal handling. Pydantic used `Decimal` with `json_encoders` coercing
// to float on output. JavaScript has no native Decimal type. To preserve precision through
// the app we model monetary values as strings (matching how Prisma's Decimal serializes and
// how the endpoints emit JSON). Validation enforces the numeric constraints (gt: 0, and a
// max of 10 total digits / 2 decimal places). If the rest of the codebase uses a Decimal
// library (e.g. decimal.js or Prisma.Decimal), swap the `decimalString` helper accordingly.
//
// MIGRATION_NOTE: `orm_mode` (ORM -> schema mapping) has no direct equivalent. The endpoints
// already return plain objects from the crud/Prisma layer, so these schemas are used for
// input validation and typing only. To enforce output shaping, call `Schema.parse(obj)` in
// the endpoint before res.json().
//
// MIGRATION_NOTE: `json_encoders` for datetime/date (isoformat) is dropped — JSON.stringify
// already emits ISO 8601 for Date objects. The `parse_dates` pre-validator that coerced ISO
// strings to datetimes is replaced by z.coerce.date(), which accepts both Date and ISO string.
//
// MIGRATION_NOTE: The `check_low_stock` computed field (Pydantic validator always=True) is
// reproduced as the `computeLowStock` helper, since Zod does not support derived/computed
// fields cleanly during parsing. Call it when building a ProductResponse.
//
// MIGRATION_NOTE: Forward references / update_forward_refs() are unnecessary here. Because we
// define base shapes first and compose them, ordering alone resolves all cross references.
//
// MIGRATION_NOTE: `PaginatedResponse` is kept for parity but could be dropped in favour of a
// generic pagination wrapper at the framework level.

import { z } from 'zod';

// --------------------------
// ENUMS
// --------------------------

export const PeriodType = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  annual: 'annual',
} as const;

export const periodTypeSchema = z.enum(['daily', 'weekly', 'monthly', 'annual']);
export type PeriodType = z.infer<typeof periodTypeSchema>;

// --------------------------
// SHARED HELPERS
// --------------------------

// MIGRATION_NOTE: Mirrors Pydantic's Field(max_digits=10, decimal_places=2). Represented as a
// string to preserve precision. Validates: optional sign, up to 8 integer digits + up to 2
// decimal places (total <= 10 significant digits).
const MONEY_REGEX = /^-?(?=\d{1,8}(?:\.\d{1,2})?$)\d{1,8}(?:\.\d{1,2})?$/;

const decimalString = (opts: { gt?: number } = {}) =>
  z
    .string()
    .regex(MONEY_REGEX, 'must have at most 10 digits and 2 decimal places')
    .refine(
      (v) => (opts.gt === undefined ? true : Number(v) > opts.gt),
      opts.gt !== undefined ? `must be greater than ${opts.gt}` : 'invalid',
    );

// --------------------------
// BASE MODELS (No relationships)
// --------------------------

export const productBaseSchema = z.object({
  name: z.string().max(255),
  description: z.string().max(1000).nullable().optional(),
  price: decimalString({ gt: 0 }),
  category: z.string().max(100),
});
export type ProductBase = z.infer<typeof productBaseSchema>;

export const inventoryBaseSchema = z.object({
  quantity: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0).default(10),
});
export type InventoryBase = z.infer<typeof inventoryBaseSchema>;

export const saleBaseSchema = z.object({
  product_id: z.number().int(),
  quantity: z.number().int().gt(0),
  unit_price: decimalString({ gt: 0 }),
});
export type SaleBase = z.infer<typeof saleBaseSchema>;

export const inventoryHistoryBaseSchema = z.object({
  previous_quantity: z.number().int(),
  new_quantity: z.number().int(),
  change_reason: z.string().max(255),
});
export type InventoryHistoryBase = z.infer<typeof inventoryHistoryBaseSchema>;

// --------------------------
// CREATE SCHEMAS
// --------------------------

export const productCreateSchema = productBaseSchema;
export type ProductCreate = z.infer<typeof productCreateSchema>;

export const inventoryCreateSchema = inventoryBaseSchema.extend({
  product_id: z.number().int(),
});
export type InventoryCreate = z.infer<typeof inventoryCreateSchema>;

export const saleCreateSchema = saleBaseSchema;
export type SaleCreate = z.infer<typeof saleCreateSchema>;

export const inventoryHistoryCreateSchema = inventoryHistoryBaseSchema.extend({
  product_id: z.number().int(),
});
export type InventoryHistoryCreate = z.infer<typeof inventoryHistoryCreateSchema>;

// --------------------------
// UPDATE SCHEMAS
// --------------------------

export const productUpdateSchema = z.object({
  name: z.string().max(255).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  price: decimalString({ gt: 0 }).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
});
export type ProductUpdate = z.infer<typeof productUpdateSchema>;

// InventoryUpdate is identical to InventoryBase in the source.
export const inventoryUpdateSchema = inventoryBaseSchema;
export type InventoryUpdate = z.infer<typeof inventoryUpdateSchema>;

// --------------------------
// MODELS WITHOUT NESTED RELATIONSHIPS
// --------------------------

export const inventorySimpleSchema = inventoryBaseSchema.extend({
  inventory_id: z.number().int(),
  // MIGRATION_NOTE: z.coerce.date accepts both Date instances and ISO strings.
  last_restocked: z.coerce.date().nullable().optional(),
  product_id: z.number().int(),
});
export type InventorySimple = z.infer<typeof inventorySimpleSchema>;

export const saleSimpleSchema = saleBaseSchema.extend({
  sale_id: z.number().int(),
  total_amount: decimalString(),
  sale_date: z.coerce.date(),
});
export type SaleSimple = z.infer<typeof saleSimpleSchema>;

export const inventoryHistorySimpleSchema = inventoryHistoryBaseSchema.extend({
  history_id: z.number().int(),
  changed_at: z.coerce.date(),
  product_id: z.number().int(),
});
export type InventoryHistorySimple = z.infer<typeof inventoryHistorySimpleSchema>;

export const productSimpleSchema = productBaseSchema.extend({
  product_id: z.number().int(),
  // MIGRATION_NOTE: parse_dates pre-validator coerced ISO strings -> datetime; z.coerce.date
  // covers that behaviour for both created_at and updated_at.
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type ProductSimple = z.infer<typeof productSimpleSchema>;

// --------------------------
// FULL MODELS WITH RELATIONSHIPS
// --------------------------

export const productSchema = productSimpleSchema.extend({
  inventory: inventorySimpleSchema.nullable().optional(),
  sales: z.array(saleSimpleSchema).default([]),
  history: z.array(inventoryHistorySimpleSchema).default([]),
});
export type Product = z.infer<typeof productSchema>;

export const inventorySchema = inventorySimpleSchema.extend({
  product: productSimpleSchema,
});
export type Inventory = z.infer<typeof inventorySchema>;

export const saleSchema = saleSimpleSchema.extend({
  product: productSimpleSchema,
});
export type Sale = z.infer<typeof saleSchema>;

export const inventoryHistorySchema = inventoryHistorySimpleSchema.extend({
  product: productSimpleSchema,
});
export type InventoryHistory = z.infer<typeof inventoryHistorySchema>;

export const revenueReportSchema = z.object({
  period_type: periodTypeSchema,
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
  total_revenue: decimalString(),
  // MIGRATION_NOTE: `dict` was untyped in Pydantic; modelled as a record of unknown.
  category_breakdown: z.record(z.string(), z.unknown()),
  comparison_period: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type RevenueReport = z.infer<typeof revenueReportSchema>;

// --------------------------
// RESPONSE MODELS
// --------------------------

export const productResponseSchema = productSimpleSchema.extend({
  inventory: inventorySimpleSchema.nullable().optional(),
  low_stock: z.boolean().nullable().optional(),
});
export type ProductResponse = z.infer<typeof productResponseSchema>;

/**
 * MIGRATION_NOTE: Replaces the Pydantic `check_low_stock` validator (always=True). Computes
 * `low_stock` from the nested inventory: true when quantity <= low_stock_threshold, otherwise
 * false, or null when no inventory is present. Call this when assembling a ProductResponse.
 */
export function computeLowStock(
  inventory: Pick<InventorySimple, 'quantity' | 'low_stock_threshold'> | null | undefined,
): boolean | null {
  if (inventory) {
    return inventory.quantity <= inventory.low_stock_threshold;
  }
  return null;
}

/**
 * Builds a fully-populated ProductResponse, deriving `low_stock` from the inventory.
 */
export function buildProductResponse(
  product: ProductSimple & { inventory?: InventorySimple | null },
): ProductResponse {
  return productResponseSchema.parse({
    ...product,
    inventory: product.inventory ?? null,
    low_stock: computeLowStock(product.inventory),
  });
}

export const inventoryStatusSchema = z.object({
  product_id: z.number().int(),
  product_name: z.string(),
  current_stock: z.number().int(),
  threshold: z.number().int(),
  last_updated: z.coerce.date(),
});
export type InventoryStatus = z.infer<typeof inventoryStatusSchema>;

// --------------------------
// UTILITY MODELS
// --------------------------

export const paginatedResponseSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int(),
  page: z.number().int(),
  pages: z.number().int(),
});
export type PaginatedResponse = z.infer<typeof paginatedResponseSchema>;

/** Combined inventory with its change history. */
export const inventoryWithHistorySchema = z.object({
  inventory: inventorySchema,
  history: z.array(inventoryHistorySchema),
});
export type InventoryWithHistory = z.infer<typeof inventoryWithHistorySchema>;

/** Revenue breakdown by category. */
export const categoryRevenueSchema = z.object({
  category: z.string(),
  revenue: z.number(),
  transactions: z.number().int(),
});
export type CategoryRevenue = z.infer<typeof categoryRevenueSchema>;

/** Schema for bulk inventory updates. */
export const inventoryBulkUpdateSchema = z.object({
  product_id: z.number().int(),
  quantity: z.number().int(),
});
export type InventoryBulkUpdate = z.infer<typeof inventoryBulkUpdateSchema>;

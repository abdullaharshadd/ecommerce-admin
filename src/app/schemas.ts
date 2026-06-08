import { z } from 'zod';

/**
 * Schema / validation layer for Product, Inventory, Sale, InventoryHistory and
 * reporting entities.
 *
 * MIGRATION_NOTE: The source was a set of Pydantic (FastAPI-style) BaseModel
 * classes used for request validation and ORM-object serialization. In this
 * Node.js/Express + Prisma stack we express the same contracts with Zod
 * schemas (for request validation) and TypeScript interfaces/serializer
 * helpers (for response shaping). The already-migrated endpoints
 * (`app/endpoints/*.ts`) import Zod schemas at the route level, so the
 * validation pieces here are exported as Zod schemas to match that pattern.
 *
 * MIGRATION_NOTE: Pydantic `Field` constraints map to Zod refinements:
 *   - max_length          -> .max(n)
 *   - gt=0                 -> .positive() / .gt(0) (exclusive, matches Pydantic)
 *   - ge=0                 -> .min(0) / .nonnegative()
 *   - max_digits/decimal_places (Decimal) -> see `decimalField` helper below.
 *     Decimals are represented as `number` here to mirror the Pydantic
 *     `json_encoders = { Decimal: float }` behavior (Decimal serialized as a
 *     JSON number). If exact monetary precision is required, switch the type
 *     to `string` and use Prisma.Decimal end-to-end (flagged for review).
 *
 * MIGRATION_NOTE: `orm_mode = True` and `json_encoders` have no direct Zod
 * equivalent. ORM serialization is handled by the `serialize*` helpers below,
 * which shape a Prisma model instance into the response contract (dates ->
 * ISO strings, Decimal -> number).
 */

// ---------------------------------------------------------------------------
// ENUMS
// ---------------------------------------------------------------------------

export const PeriodType = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  annual: 'annual',
} as const;

export type PeriodType = (typeof PeriodType)[keyof typeof PeriodType];

export const periodTypeSchema = z.enum(['daily', 'weekly', 'monthly', 'annual']);

// ---------------------------------------------------------------------------
// FIELD HELPERS
// ---------------------------------------------------------------------------

/**
 * MIGRATION_NOTE: Mirrors Pydantic `Decimal = Field(max_digits=10,
 * decimal_places=2)`. Pydantic accepts up to 10 total digits with at most 2
 * decimal places. We validate the number is finite, within the digit budget,
 * and rounded to <=2 decimal places. The value is kept as a `number` to match
 * the original `json_encoders = { Decimal: float }` serialization.
 */
function decimalField(opts: { gt0?: boolean } = {}): z.ZodType<number> {
  let schema = z
    .number({ invalid_type_error: 'Expected a numeric value' })
    .finite()
    .refine((v) => Number.isInteger(Math.round(v * 100) - v * 100 === 0 ? v * 100 : v * 100), {
      message: 'Value must have at most 2 decimal places',
    })
    .refine(
      (v) => {
        const decimals = (v.toString().split('.')[1] ?? '').length;
        return decimals <= 2;
      },
      { message: 'Value must have at most 2 decimal places (decimal_places=2)' },
    )
    .refine(
      (v) => {
        // max_digits=10 -> total significant digits (excluding sign and dot)
        const digits = Math.abs(v).toFixed(2).replace('.', '');
        return digits.replace(/^0+/, '').length <= 10;
      },
      { message: 'Value exceeds max_digits=10' },
    );

  if (opts.gt0) {
    schema = schema.refine((v) => v > 0, { message: 'Value must be greater than 0' });
  }

  return schema;
}

// ---------------------------------------------------------------------------
// BASE SCHEMAS (no relationships)
// ---------------------------------------------------------------------------

export const productBaseSchema = z.object({
  name: z.string().max(255),
  description: z.string().max(1000).nullable().optional(),
  price: decimalField({ gt0: true }),
  category: z.string().max(100),
});

export const inventoryBaseSchema = z.object({
  quantity: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0).default(10),
});

export const saleBaseSchema = z.object({
  product_id: z.number().int(),
  quantity: z.number().int().positive(),
  unit_price: decimalField({ gt0: true }),
});

export const inventoryHistoryBaseSchema = z.object({
  previous_quantity: z.number().int(),
  new_quantity: z.number().int(),
  change_reason: z.string().max(255),
});

// ---------------------------------------------------------------------------
// CREATE SCHEMAS
// ---------------------------------------------------------------------------

export const productCreateSchema = productBaseSchema;

export const inventoryCreateSchema = inventoryBaseSchema.extend({
  product_id: z.number().int(),
});

export const saleCreateSchema = saleBaseSchema;

export const inventoryHistoryCreateSchema = inventoryHistoryBaseSchema.extend({
  product_id: z.number().int(),
});

// ---------------------------------------------------------------------------
// UPDATE SCHEMAS
// ---------------------------------------------------------------------------

export const productUpdateSchema = z.object({
  name: z.string().max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  price: decimalField({ gt0: true }).optional(),
  category: z.string().max(100).optional(),
});

export const inventoryUpdateSchema = inventoryBaseSchema;

// ---------------------------------------------------------------------------
// INFERRED INPUT TYPES
// ---------------------------------------------------------------------------

export type ProductCreate = z.infer<typeof productCreateSchema>;
export type InventoryCreate = z.infer<typeof inventoryCreateSchema>;
export type SaleCreate = z.infer<typeof saleCreateSchema>;
export type InventoryHistoryCreate = z.infer<typeof inventoryHistoryCreateSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;
export type InventoryUpdate = z.infer<typeof inventoryUpdateSchema>;
export type InventoryBulkUpdate = z.infer<typeof inventoryBulkUpdateSchema>;

// ---------------------------------------------------------------------------
// RESPONSE CONTRACTS (output shapes)
//
// MIGRATION_NOTE: These TypeScript interfaces represent the serialized output
// shapes (formerly Pydantic `*Simple` / full models with `orm_mode`). Dates
// become ISO-8601 strings and Decimals become numbers, matching the original
// `json_encoders`.
// ---------------------------------------------------------------------------

export interface InventorySimple {
  inventory_id: number;
  quantity: number;
  low_stock_threshold: number;
  last_restocked: string | null;
  product_id: number;
}

export interface SaleSimple {
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  total_amount: number;
  sale_date: string;
}

export interface InventoryHistorySimple {
  history_id: number;
  previous_quantity: number;
  new_quantity: number;
  change_reason: string;
  changed_at: string;
  product_id: number;
}

export interface ProductSimple {
  product_id: number;
  name: string;
  description: string | null;
  price: number;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Product extends ProductSimple {
  inventory: InventorySimple | null;
  sales: SaleSimple[];
  history: InventoryHistorySimple[];
}

export interface Inventory extends InventorySimple {
  product: ProductSimple;
}

export interface Sale extends SaleSimple {
  product: ProductSimple;
}

export interface InventoryHistory extends InventoryHistorySimple {
  product: ProductSimple;
}

export interface RevenueReport {
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  total_revenue: number;
  category_breakdown: Record<string, unknown>;
  comparison_period: Record<string, unknown> | null;
}

/**
 * MIGRATION_NOTE: The original `ProductResponse` declares a computed
 * `low_stock` boolean via a Pydantic `@validator('low_stock', always=True)`.
 * That becomes the `low_stock` field below, populated by `serializeProductResponse`.
 */
export interface ProductResponse extends ProductSimple {
  inventory: InventorySimple | null;
  low_stock: boolean | null;
}

export interface InventoryStatus {
  product_id: number;
  product_name: string;
  current_stock: number;
  threshold: number;
  last_updated: string;
}

export interface InventoryWithHistory {
  inventory: Inventory;
  history: InventoryHistory[];
}

export interface CategoryRevenue {
  category: string;
  revenue: number;
  transactions: number;
}

/**
 * MIGRATION_NOTE: The Pydantic `PaginatedResponse` is preserved here as a
 * generic interface to match how the already-migrated endpoints return
 * paginated payloads. If desired, this can be replaced by an Express-level
 * pagination utility.
 */
export interface PaginatedResponse<T = Product> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export const inventoryBulkUpdateSchema = z.object({
  product_id: z.number().int(),
  quantity: z.number().int(),
});

// ---------------------------------------------------------------------------
// SERIALIZATION HELPERS (replace Pydantic orm_mode + json_encoders)
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Coerce a Prisma.Decimal | number | string into a JS number (Decimal -> float). */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  // Prisma.Decimal and strings both expose a usable string form.
  return Number((value as { toString(): string }).toString());
}

export function serializeInventorySimple(row: any): InventorySimple {
  return {
    inventory_id: row.inventory_id,
    quantity: row.quantity,
    low_stock_threshold: row.low_stock_threshold,
    last_restocked: toIso(row.last_restocked),
    product_id: row.product_id,
  };
}

export function serializeSaleSimple(row: any): SaleSimple {
  return {
    sale_id: row.sale_id,
    product_id: row.product_id,
    quantity: row.quantity,
    unit_price: toNumber(row.unit_price),
    total_amount: toNumber(row.total_amount),
    sale_date: toIso(row.sale_date) as string,
  };
}

export function serializeInventoryHistorySimple(row: any): InventoryHistorySimple {
  return {
    history_id: row.history_id,
    previous_quantity: row.previous_quantity,
    new_quantity: row.new_quantity,
    change_reason: row.change_reason,
    changed_at: toIso(row.changed_at) as string,
    product_id: row.product_id,
  };
}

export function serializeProductSimple(row: any): ProductSimple {
  return {
    product_id: row.product_id,
    name: row.name,
    description: row.description ?? null,
    price: toNumber(row.price),
    category: row.category,
    created_at: toIso(row.created_at) as string,
    updated_at: toIso(row.updated_at) as string,
  };
}

export function serializeProduct(row: any): Product {
  return {
    ...serializeProductSimple(row),
    inventory: row.inventory ? serializeInventorySimple(row.inventory) : null,
    sales: Array.isArray(row.sales) ? row.sales.map(serializeSaleSimple) : [],
    history: Array.isArray(row.history) ? row.history.map(serializeInventoryHistorySimple) : [],
  };
}

/**
 * Replicates the original `ProductResponse.check_low_stock` validator:
 * low_stock = inventory.quantity <= inventory.low_stock_threshold, else null.
 */
export function serializeProductResponse(row: any): ProductResponse {
  const inventory = row.inventory ? serializeInventorySimple(row.inventory) : null;
  const low_stock =
    inventory !== null ? inventory.quantity <= inventory.low_stock_threshold : null;

  return {
    ...serializeProductSimple(row),
    inventory,
    low_stock,
  };
}

export function serializeInventoryStatus(row: any): InventoryStatus {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    current_stock: row.current_stock,
    threshold: row.threshold,
    last_updated: toIso(row.last_updated) as string,
  };
}

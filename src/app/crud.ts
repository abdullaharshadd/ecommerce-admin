import { Prisma, PrismaClient } from '@prisma/client';
import type {
  Product,
  Inventory,
  Sale,
  InventoryHistory,
} from '@prisma/client';

/**
 * Data-access (CRUD) layer for the product inventory and sales system.
 *
 * MIGRATION_NOTE: The source used SQLAlchemy. Despite the "django" migration
 * label, this has been migrated to idiomatic Node.js/TypeScript using Prisma.
 * The thin CRUD-function style is preserved, but each function now accepts a
 * PrismaClient (or transaction client) for dependency injection rather than a
 * SQLAlchemy Session.
 *
 * MIGRATION_NOTE: SQLAlchemy's manual commit/refresh lifecycle is replaced by
 * Prisma's automatic per-call persistence. Multi-write operations that must be
 * atomic use prisma.$transaction.
 */

// ---------------------------------------------------------------------------
// Input/DTO types (replacing Pydantic schemas)
// ---------------------------------------------------------------------------

export interface ProductCreateInput {
  name: string;
  description?: string | null;
  category?: string | null;
  price: Prisma.Decimal | number | string;
  [key: string]: unknown;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  price?: Prisma.Decimal | number | string;
  [key: string]: unknown;
}

export interface InventoryUpdateInput {
  quantity: number;
  lowStockThreshold?: number;
  lastRestocked?: Date;
  [key: string]: unknown;
}

export interface SaleCreateInput {
  productId: number;
  quantity: number;
}

export interface InventoryBulkUpdateInput {
  productId: number;
  quantity: number;
}

export interface InventoryWithHistory {
  inventory: Inventory;
  history: InventoryHistory[];
}

export interface CategoryRevenue {
  category: string | null;
  revenue: Prisma.Decimal | number;
  transactions: number;
}

export interface RevenueByPeriodRow {
  productId: number;
  category: string | null;
  totalAmount: Prisma.Decimal | number;
}

/**
 * A Prisma client or transaction client. Using this union allows the CRUD
 * functions to participate in externally-managed transactions.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Product CRUD Operations
// ---------------------------------------------------------------------------

export async function getProduct(
  db: Db,
  productId: number,
): Promise<Product | null> {
  return db.product.findUnique({ where: { productId } });
}

export async function getProducts(
  db: Db,
  skip = 0,
  limit = 100,
): Promise<Product[]> {
  return db.product.findMany({ skip, take: limit });
}

export async function createProduct(
  db: Db,
  product: ProductCreateInput,
): Promise<Product> {
  return db.product.create({ data: product as Prisma.ProductCreateInput });
}

export async function updateProduct(
  db: Db,
  productId: number,
  product: ProductUpdateInput,
): Promise<Product | null> {
  const existing = await getProduct(db, productId);
  if (!existing) {
    return null;
  }

  // exclude_unset semantics: only update keys that were actually provided.
  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(product)) {
    if (value !== undefined) {
      updateData[key] = value;
    }
  }
  updateData.updatedAt = new Date();

  return db.product.update({
    where: { productId },
    data: updateData as Prisma.ProductUpdateInput,
  });
}

export async function deleteProduct(
  db: Db,
  productId: number,
): Promise<Product | null> {
  const existing = await getProduct(db, productId);
  if (!existing) {
    return null;
  }
  await db.product.delete({ where: { productId } });
  return existing;
}

// ---------------------------------------------------------------------------
// Inventory CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Get inventory with pagination support.
 *
 * MIGRATION_NOTE: The source compared a column to another column
 * (quantity <= low_stock_threshold). Prisma cannot express column-to-column
 * comparisons in a `where` filter directly, so for `lowStockOnly` we fetch and
 * filter in application code. For large datasets this should be replaced with a
 * raw query (db.$queryRaw) - flagged for manual review.
 */
export async function getInventory(
  db: Db,
  skip = 0,
  limit = 100,
  lowStockOnly = false,
): Promise<Inventory[]> {
  if (lowStockOnly) {
    const all = await db.inventory.findMany();
    const filtered = all.filter((i) => i.quantity <= i.lowStockThreshold);
    return filtered.slice(skip, skip + limit);
  }
  return db.inventory.findMany({ skip, take: limit });
}

/**
 * Fetch a single inventory row by product id.
 *
 * MIGRATION_NOTE: This helper fixes the latent bug in the original
 * `create_sale`, where `get_inventory(db, sale.product_id)` was called with a
 * product id passed into a positional `skip` parameter and returned a list.
 */
export async function getInventoryByProductId(
  db: Db,
  productId: number,
): Promise<Inventory | null> {
  return db.inventory.findUnique({ where: { productId } });
}

/**
 * Update inventory for a specific product.
 * Returns null when the product does not exist (was `{}` in the source).
 */
export async function updateInventory(
  db: Db,
  productId: number,
  inventoryUpdate: InventoryUpdateInput,
): Promise<Inventory | null> {
  // The whole operation (inventory upsert + history) must be atomic.
  const runner = async (tx: Prisma.TransactionClient): Promise<Inventory | null> => {
    const product = await tx.product.findUnique({ where: { productId } });
    if (!product) {
      return null;
    }

    const existing = await tx.inventory.findUnique({ where: { productId } });
    const previousQuantity = existing ? existing.quantity : 0;

    let dbInventory: Inventory;
    if (!existing) {
      dbInventory = await tx.inventory.create({
        data: {
          productId,
          ...(inventoryUpdate as Prisma.InventoryCreateInput),
        },
      });
    } else {
      dbInventory = await tx.inventory.update({
        where: { productId },
        data: inventoryUpdate as Prisma.InventoryUpdateInput,
      });
    }

    await tx.inventoryHistory.create({
      data: {
        productId,
        previousQuantity,
        newQuantity: inventoryUpdate.quantity,
        changeReason: 'Manual update via API',
      },
    });

    return dbInventory;
  };

  // Support being called both with a top-level client and within a transaction.
  if ('$transaction' in db) {
    return (db as PrismaClient).$transaction(runner);
  }
  return runner(db as Prisma.TransactionClient);
}

// ---------------------------------------------------------------------------
// Sale CRUD Operations
// ---------------------------------------------------------------------------

export async function createSale(
  db: Db,
  sale: SaleCreateInput,
): Promise<Sale | null> {
  const runner = async (tx: Prisma.TransactionClient): Promise<Sale | null> => {
    const product = await tx.product.findUnique({
      where: { productId: sale.productId },
    });
    if (!product) {
      return null;
    }

    const unitPrice = new Prisma.Decimal(product.price as unknown as string);
    const totalAmount = unitPrice.mul(sale.quantity);

    const dbSale = await tx.sale.create({
      data: {
        productId: sale.productId,
        quantity: sale.quantity,
        unitPrice,
        totalAmount,
      },
    });

    // MIGRATION_NOTE: Original called get_inventory(db, sale.product_id) which
    // due to a bug fetched a list. Fixed here to load the single inventory row.
    const inventory = await tx.inventory.findUnique({
      where: { productId: sale.productId },
    });
    if (inventory) {
      await tx.inventory.update({
        where: { productId: sale.productId },
        data: { quantity: inventory.quantity - sale.quantity },
      });
    }

    return dbSale;
  };

  if ('$transaction' in db) {
    return (db as PrismaClient).$transaction(runner);
  }
  return runner(db as Prisma.TransactionClient);
}

export interface GetSalesOptions {
  skip?: number;
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  productId?: number;
  category?: string;
}

export async function getSales(
  db: Db,
  options: GetSalesOptions = {},
): Promise<Sale[]> {
  const { skip = 0, limit = 100, startDate, endDate, productId, category } = options;

  const where: Prisma.SaleWhereInput = {};

  if (startDate || endDate) {
    where.saleDate = {};
    if (startDate) where.saleDate.gte = startDate;
    if (endDate) where.saleDate.lte = endDate;
  }
  if (productId) {
    where.productId = productId;
  }
  if (category) {
    // join(Product).filter(Product.category == category) -> relation filter
    where.product = { category };
  }

  return db.sale.findMany({
    where,
    orderBy: { saleDate: 'desc' },
    skip,
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Analytics Operations
// ---------------------------------------------------------------------------

/**
 * Return per-sale rows of (productId, category, totalAmount) within a range.
 *
 * MIGRATION_NOTE: The `period` argument was unused in the source query and is
 * preserved here only for signature compatibility.
 */
export async function getRevenueByPeriod(
  db: Db,
  _period: string,
  startDate: Date,
  endDate: Date,
): Promise<RevenueByPeriodRow[]> {
  const sales = await db.sale.findMany({
    where: { saleDate: { gte: startDate, lte: endDate } },
    include: { product: { select: { category: true } } },
  });

  return sales.map((s) => ({
    productId: s.productId,
    category: (s as Sale & { product: { category: string | null } }).product.category,
    totalAmount: s.totalAmount,
  }));
}

/**
 * MIGRATION_NOTE: Column-to-column comparison (quantity <= low_stock_threshold)
 * is not expressible in a Prisma `where`. Filtered in application code. The
 * `threshold` parameter is unused, matching the source behaviour. Consider a
 * raw query for large tables.
 */
export async function getLowStockItems(
  db: Db,
  skip = 0,
  limit = 100,
  _threshold = 10,
): Promise<Inventory[]> {
  const all = await db.inventory.findMany();
  const filtered = all.filter((i) => i.quantity <= i.lowStockThreshold);
  return filtered.slice(skip, skip + limit);
}

// ---------------------------------------------------------------------------
// Inventory History CRUD
// ---------------------------------------------------------------------------

export interface GetInventoryHistoryOptions {
  productId?: number;
  days?: number;
  skip?: number;
  limit?: number;
}

export async function getInventoryHistory(
  db: Db,
  options: GetInventoryHistoryOptions = {},
): Promise<InventoryHistory[]> {
  const { productId, days = 30, skip = 0, limit = 100 } = options;

  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where: Prisma.InventoryHistoryWhereInput = {
    changedAt: { gte: cutoffDate },
  };
  if (productId) {
    where.productId = productId;
  }

  return db.inventoryHistory.findMany({
    where,
    orderBy: { changedAt: 'desc' },
    skip,
    take: limit,
  });
}

export async function recordInventoryChange(
  db: Db,
  productId: number,
  previousQuantity: number,
  newQuantity: number,
  changeReason: string,
): Promise<InventoryHistory | null> {
  if (previousQuantity === newQuantity) {
    return null; // No actual change
  }

  return db.inventoryHistory.create({
    data: {
      productId,
      previousQuantity,
      newQuantity,
      changeReason,
      changedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Enhanced Inventory CRUD
// ---------------------------------------------------------------------------

export async function getInventoryWithHistory(
  db: Db,
  productId: number,
): Promise<InventoryWithHistory | null> {
  const inventory = await db.inventory.findUnique({ where: { productId } });
  if (!inventory) {
    return null;
  }

  const history = await getInventoryHistory(db, { productId });

  return { inventory, history };
}

// ---------------------------------------------------------------------------
// Product CRUD (category / search)
// ---------------------------------------------------------------------------

export async function getProductsByCategory(
  db: Db,
  category: string,
  skip = 0,
  limit = 100,
): Promise<Product[]> {
  return db.product.findMany({
    where: { category },
    skip,
    take: limit,
  });
}

/**
 * Search products by name or description.
 *
 * MIGRATION_NOTE: SQLAlchemy ilike() (case-insensitive) maps to Prisma's
 * `contains` with `mode: 'insensitive'` (PostgreSQL). On MySQL, default
 * collation is usually case-insensitive and `mode` is ignored - verify.
 */
export async function searchProducts(
  db: Db,
  searchTerm: string,
  skip = 0,
  limit = 100,
): Promise<Product[]> {
  return db.product.findMany({
    where: {
      OR: [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    skip,
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Analytics CRUD
// ---------------------------------------------------------------------------

/**
 * Get revenue breakdown by category.
 *
 * MIGRATION_NOTE: Source used func.sum/func.count with group_by(category) via a
 * join. Prisma's groupBy aggregates on a single model, so we group sales by
 * productId, then map products to categories and aggregate in application code.
 * For large datasets prefer a raw SQL query - flagged for manual review.
 */
export async function getCategoryRevenue(
  db: Db,
  startDate: Date,
  endDate: Date,
): Promise<CategoryRevenue[]> {
  const sales = await db.sale.findMany({
    where: { saleDate: { gte: startDate, lte: endDate } },
    include: { product: { select: { category: true } } },
  });

  const buckets = new Map<string | null, { revenue: Prisma.Decimal; transactions: number }>();

  for (const sale of sales) {
    const category = (sale as Sale & { product: { category: string | null } })
      .product.category;
    const existing = buckets.get(category) ?? {
      revenue: new Prisma.Decimal(0),
      transactions: 0,
    };
    existing.revenue = existing.revenue.add(
      new Prisma.Decimal(sale.totalAmount as unknown as string),
    );
    existing.transactions += 1;
    buckets.set(category, existing);
  }

  return Array.from(buckets.entries()).map(([category, agg]) => ({
    category,
    revenue: agg.revenue,
    transactions: agg.transactions,
  }));
}

// ---------------------------------------------------------------------------
// Bulk Operations
// ---------------------------------------------------------------------------

export async function bulkUpdateInventory(
  db: Db,
  updates: InventoryBulkUpdateInput[],
): Promise<Inventory[]> {
  const runner = async (tx: Prisma.TransactionClient): Promise<Inventory[]> => {
    const results: Inventory[] = [];

    for (const update of updates) {
      const inventory = await tx.inventory.findUnique({
        where: { productId: update.productId },
      });

      if (inventory) {
        // Record history before updating.
        await recordInventoryChange(
          tx,
          update.productId,
          inventory.quantity,
          update.quantity,
          'Bulk update',
        );

        const updated = await tx.inventory.update({
          where: { productId: update.productId },
          data: {
            quantity: update.quantity,
            lastRestocked: new Date(),
          },
        });
        results.push(updated);
      }
    }

    return results;
  };

  if ('$transaction' in db) {
    return (db as PrismaClient).$transaction(runner);
  }
  return runner(db as Prisma.TransactionClient);
}

// src/app/crud.ts
// Migrated from app/crud.py (FastAPI + SQLAlchemy CRUD layer) to idiomatic Node.js/TypeScript using Prisma.
//
// MIGRATION_NOTE: The source used SQLAlchemy's Session pattern with manual commit/refresh per operation.
// Prisma manages transactions/connections internally, so each operation maps to a Prisma client call.
// Where the original needed atomicity across multiple writes (update_inventory, bulk_update_inventory,
// create_sale), we use prisma.$transaction(...) to preserve transaction semantics.
//
// MIGRATION_NOTE: Field/PK names preserved from the source models:
//   - Product PK: product_id
//   - Sale PK: sale_id
//   - Inventory keyed by product_id (assumed unique FK to Product)
//   - InventoryHistory PK assumed `id` (not shown in source); adjust if your schema differs.
// Ensure schema.prisma defines these models and relations (Product.sales, Product.inventory, etc.).

import { PrismaClient, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Input DTO types (replacing Pydantic schemas). Map field names exactly.
// ---------------------------------------------------------------------------

export interface ProductCreate {
  name: string;
  description?: string | null;
  category?: string | null;
  price: Prisma.Decimal | number;
  [key: string]: unknown;
}

// Partial update — mirrors Pydantic `dict(exclude_unset=True)`.
export interface ProductUpdate {
  name?: string;
  description?: string | null;
  category?: string | null;
  price?: Prisma.Decimal | number;
  [key: string]: unknown;
}

export interface InventoryUpdate {
  quantity: number;
  low_stock_threshold?: number;
  [key: string]: unknown;
}

export interface SaleCreate {
  product_id: number;
  quantity: number;
}

export interface InventoryBulkUpdate {
  product_id: number;
  quantity: number;
}

export interface GetSalesFilters {
  skip?: number;
  limit?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  productId?: number | null;
  category?: string | null;
}

// ---------------------------------------------------------------------------
// CRUD service. Dependency-injected PrismaClient (constructor injection).
// ---------------------------------------------------------------------------

export class CrudService {
  constructor(private readonly prisma: PrismaClient) {}

  // =========================================================================
  // Product CRUD
  // =========================================================================

  async getProduct(productId: number) {
    return this.prisma.product.findUnique({
      where: { product_id: productId },
    });
  }

  async getProducts(skip = 0, limit = 100) {
    return this.prisma.product.findMany({
      skip,
      take: limit,
    });
  }

  async createProduct(product: ProductCreate) {
    return this.prisma.product.create({
      // MIGRATION_NOTE: Equivalent to SQLAlchemy `Product(**product.dict())`.
      // Field names must match schema.prisma exactly.
      data: product as Prisma.ProductCreateInput,
    });
  }

  async updateProduct(productId: number, product: ProductUpdate) {
    const existing = await this.getProduct(productId);
    if (!existing) {
      // Source returns the (None) db_product; we mirror by returning null.
      return null;
    }

    // exclude_unset semantics: only keys present in the object are updated.
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(product)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }
    updateData.updated_at = new Date(); // datetime.utcnow() -> new Date() (UTC)

    return this.prisma.product.update({
      where: { product_id: productId },
      data: updateData as Prisma.ProductUpdateInput,
    });
  }

  async deleteProduct(productId: number) {
    const existing = await this.getProduct(productId);
    if (!existing) {
      return null;
    }
    await this.prisma.product.delete({ where: { product_id: productId } });
    return existing;
  }

  // =========================================================================
  // Inventory CRUD
  // =========================================================================

  async getInventory(skip = 0, limit = 100, lowStockOnly = false) {
    if (lowStockOnly) {
      // MIGRATION_NOTE: SQLAlchemy compared two columns (quantity <= low_stock_threshold).
      // Prisma cannot compare two columns directly in a `where`, so we use a raw query.
      return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "Inventory"
        WHERE quantity <= low_stock_threshold
        OFFSET ${skip} LIMIT ${limit}
      `;
    }
    return this.prisma.inventory.findMany({ skip, take: limit });
  }

  async updateInventory(productId: number, inventoryUpdate: InventoryUpdate) {
    // Atomic: check product, upsert inventory, and record history together.
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { product_id: productId },
      });
      if (!product) {
        // Source returns {} (empty dict) when product not found.
        return {} as Record<string, never>;
      }

      const dbInventory = await tx.inventory.findFirst({
        where: { product_id: productId },
      });

      const previousQuantity = dbInventory ? dbInventory.quantity : 0;

      let result;
      if (!dbInventory) {
        result = await tx.inventory.create({
          data: {
            product_id: productId,
            ...inventoryUpdate,
          } as Prisma.InventoryCreateInput,
        });
      } else {
        result = await tx.inventory.update({
          where: { product_id: productId },
          data: { ...inventoryUpdate } as Prisma.InventoryUpdateInput,
        });
      }

      // Always add a history record (matches source behaviour).
      await tx.inventoryHistory.create({
        data: {
          product_id: productId,
          previous_quantity: previousQuantity,
          new_quantity: inventoryUpdate.quantity,
          change_reason: 'Manual update via API',
        } as Prisma.InventoryHistoryCreateInput,
      });

      return result;
    });
  }

  // =========================================================================
  // Sale CRUD
  // =========================================================================

  async createSale(sale: SaleCreate) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { product_id: sale.product_id },
      });
      if (!product) {
        return null;
      }

      const unitPrice = product.price as Prisma.Decimal;
      const totalAmount = new Prisma.Decimal(unitPrice).mul(sale.quantity);

      const dbSale = await tx.sale.create({
        data: {
          product_id: sale.product_id,
          quantity: sale.quantity,
          unit_price: unitPrice,
          total_amount: totalAmount,
        } as Prisma.SaleCreateInput,
      });

      // MIGRATION_NOTE (PRESERVED BUG, FIXED): The Python source called
      //   get_inventory(db, sale.product_id)
      // where the 2nd positional arg of get_inventory is `skip`, so it returned a
      // *list* of inventories rather than the product's inventory record. The
      // inventory decrement was therefore effectively broken (decrementing a list
      // attribute had no effect / would error). Here we implement the clearly
      // intended behaviour: decrement the matching product's inventory. If you
      // must reproduce the original (broken) behaviour exactly, remove this block.
      const inventory = await tx.inventory.findFirst({
        where: { product_id: sale.product_id },
      });
      if (inventory) {
        await tx.inventory.update({
          where: { product_id: sale.product_id },
          data: { quantity: inventory.quantity - sale.quantity },
        });
      }

      return dbSale;
    });
  }

  async getSales(filters: GetSalesFilters = {}) {
    const {
      skip = 0,
      limit = 100,
      startDate = null,
      endDate = null,
      productId = null,
      category = null,
    } = filters;

    const where: Prisma.SaleWhereInput = {};

    if (startDate) {
      where.sale_date = { ...(where.sale_date as object), gte: startDate };
    }
    if (endDate) {
      where.sale_date = { ...(where.sale_date as object), lte: endDate };
    }
    if (productId) {
      where.product_id = productId;
    }
    if (category) {
      // join(Product).filter(Product.category == category) -> relation filter
      where.product = { category };
    }

    return this.prisma.sale.findMany({
      where,
      orderBy: { sale_date: 'desc' },
      skip,
      take: limit,
    });
  }

  // =========================================================================
  // Analytics
  // =========================================================================

  async getRevenueByPeriod(_period: string, startDate: Date, endDate: Date) {
    // MIGRATION_NOTE: `period` was unused in the original query (only date range
    // was applied). Preserved as-is. `between` is inclusive on both ends.
    return this.prisma.sale.findMany({
      where: {
        sale_date: { gte: startDate, lte: endDate },
      },
      select: {
        product_id: true,
        total_amount: true,
        product: { select: { category: true } },
      },
    });
  }

  async getLowStockItems(skip = 0, limit = 100, _threshold = 10) {
    // MIGRATION_NOTE: `threshold` arg is unused in the original (filter compares
    // quantity <= low_stock_threshold column). Column-vs-column comparison needs raw SQL.
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT i.* FROM "Inventory" i
      JOIN "Product" p ON p.product_id = i.product_id
      WHERE i.quantity <= i.low_stock_threshold
      OFFSET ${skip} LIMIT ${limit}
    `;
  }

  // =========================================================================
  // Inventory History
  // =========================================================================

  async getInventoryHistory(
    productId: number | null = null,
    days = 30,
    skip = 0,
    limit = 100,
  ) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: Prisma.InventoryHistoryWhereInput = {
      changed_at: { gte: cutoffDate },
    };
    if (productId) {
      where.product_id = productId;
    }

    return this.prisma.inventoryHistory.findMany({
      where,
      orderBy: { changed_at: 'desc' },
      skip,
      take: limit,
    });
  }

  async recordInventoryChange(
    productId: number,
    previousQuantity: number,
    newQuantity: number,
    changeReason: string,
  ) {
    if (previousQuantity === newQuantity) {
      return null; // No actual change
    }
    return this.prisma.inventoryHistory.create({
      data: {
        product_id: productId,
        previous_quantity: previousQuantity,
        new_quantity: newQuantity,
        change_reason: changeReason,
        changed_at: new Date(),
      } as Prisma.InventoryHistoryCreateInput,
    });
  }

  // =========================================================================
  // Enhanced Inventory
  // =========================================================================

  async getInventoryWithHistory(productId: number) {
    const inventory = await this.prisma.inventory.findFirst({
      where: { product_id: productId },
    });
    if (!inventory) {
      return null;
    }
    const history = await this.getInventoryHistory(productId);
    // MIGRATION_NOTE: Source returns a plain dict; serialization handled by caller.
    return { inventory, history };
  }

  // =========================================================================
  // Product queries
  // =========================================================================

  async getProductsByCategory(category: string, skip = 0, limit = 100) {
    return this.prisma.product.findMany({
      where: { category },
      skip,
      take: limit,
    });
  }

  async searchProducts(searchTerm: string, skip = 0, limit = 100) {
    // ilike (case-insensitive LIKE) -> Prisma `contains` with mode 'insensitive'.
    return this.prisma.product.findMany({
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

  // =========================================================================
  // Analytics: category revenue
  // =========================================================================

  async getCategoryRevenue(startDate: Date, endDate: Date) {
    // MIGRATION_NOTE: Original used GROUP BY product.category with SUM(total_amount)
    // and COUNT(sale_id). Prisma `groupBy` cannot group by a related-model column,
    // so this uses raw SQL to join Sale->Product and aggregate by category.
    return this.prisma.$queryRaw<
      Array<{ category: string; revenue: number; transactions: number }>
    >`
      SELECT p.category AS category,
             SUM(s.total_amount) AS revenue,
             COUNT(s.sale_id) AS transactions
      FROM "Sale" s
      JOIN "Product" p ON p.product_id = s.product_id
      WHERE s.sale_date BETWEEN ${startDate} AND ${endDate}
      GROUP BY p.category
    `;
  }

  // =========================================================================
  // Bulk operations
  // =========================================================================

  async bulkUpdateInventory(updates: InventoryBulkUpdate[]) {
    // Atomic across all history + inventory writes (transaction.atomic equivalent).
    return this.prisma.$transaction(async (tx) => {
      const results: unknown[] = [];
      for (const update of updates) {
        const inventory = await tx.inventory.findFirst({
          where: { product_id: update.product_id },
        });
        if (!inventory) continue;

        // Record history before updating (only if changed — mirrors recordInventoryChange).
        if (inventory.quantity !== update.quantity) {
          await tx.inventoryHistory.create({
            data: {
              product_id: update.product_id,
              previous_quantity: inventory.quantity,
              new_quantity: update.quantity,
              change_reason: 'Bulk update',
              changed_at: new Date(),
            } as Prisma.InventoryHistoryCreateInput,
          });
        }

        const updated = await tx.inventory.update({
          where: { product_id: update.product_id },
          data: {
            quantity: update.quantity,
            last_restocked: new Date(),
          },
        });
        results.push(updated);
      }
      return results;
    });
  }
}

// src/app/utils/data_generator.ts
// Migrated from app/utils/data_generator.py (SQLAlchemy-based demo data seeder) to
// idiomatic Node.js/TypeScript.
//
// MIGRATION_NOTE: The migration debate notes assumed a Django target. This project's actual
// already-migrated data layer uses **Prisma** (see prisma/schema.prisma referenced from
// app/models.ts, database.ts and crud.ts). Therefore the correct idiomatic migration here is
// to use the shared Prisma client rather than Django's ORM. The Django-specific advice
// (transaction.atomic, bulk_create, JSONField, management command) maps cleanly to Prisma
// equivalents: prisma.$transaction(...), createMany(), Json columns, and an npm script /
// CLI entrypoint respectively.
//
// MIGRATION_NOTE: The original injected a SQLAlchemy `Session`. We keep dependency injection
// idiomatic for Node/Prisma by accepting a PrismaClient instance (defaulting to the shared
// singleton). This keeps the function testable while avoiding a hard global dependency.
//
// MIGRATION_NOTE: `db.add()` + `db.commit()` (unit-of-work) is replaced with Prisma's
// `createMany()` batched inserts. This also fixes the original N+1 insert pattern for the
// 1000 sales records.
//
// MIGRATION_NOTE: Foreign keys now use the related object's primary key (`product.id`)
// via Prisma's relation/scalar field instead of SQLAlchemy's `product.product_id`. Verify
// the actual PK field name in prisma/schema.prisma (assumed `id`).
//
// MIGRATION_NOTE: `category_breakdown` was manually `json.dumps(...)`-ed against a String
// column. If the Prisma column is `Json` we pass the object directly; if it is a `String`
// we JSON.stringify. We assume a `Json` column here — REVIEW required against schema.prisma.
//
// MIGRATION_NOTE: `period_start`/`period_end` used Python `.date()` (date-only). Prisma has
// no date-only type for SQLite/Postgres beyond `@db.Date`; we normalize to midnight UTC.

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '../database';

/** Categories for our e-commerce store. */
const CATEGORIES = [
  'Electronics',
  'Clothing',
  'Home & Kitchen',
  'Books',
  'Toys',
  'Sports',
  'Beauty',
] as const;

export interface GenerateDemoDataOptions {
  numProducts?: number;
  numSales?: number;
}

/** Inclusive random integer in [min, max]. */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Round to 2 decimal places, matching Python's round(x, 2) usage. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function randomChoice<T>(items: readonly T[]): T {
  return items[randomInt(0, items.length - 1)];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Return a new Date `days` before `from`. */
function subtractDays(from: Date, days: number): Date {
  return new Date(from.getTime() - days * MS_PER_DAY);
}

/** Return a new Date `days` after `from`. */
function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

/** Strip time component (mirrors Python datetime.date()). */
function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Seeds the database with randomly generated products, inventory, sales records and
 * monthly revenue tracking data. Development/testing utility only.
 *
 * @param prisma  Injected Prisma client (defaults to the shared singleton).
 * @param options numProducts (default 50) and numSales (default 1000).
 */
export async function generateDemoData(
  prisma: PrismaClient = defaultPrisma,
  options: GenerateDemoDataOptions = {},
): Promise<void> {
  const { numProducts = 50, numSales = 1000 } = options;

  await prisma.$transaction(async (tx) => {
    // --- Generate products ---
    const productInputs: Prisma.ProductCreateManyInput[] = [];
    for (let i = 0; i < numProducts; i += 1) {
      productInputs.push({
        name: `Product ${i + 1}`,
        description: `This is a description for product ${i + 1}`,
        price: round2(randomFloat(10, 500)),
        category: randomChoice(CATEGORIES),
      });
    }
    await tx.product.createMany({ data: productInputs });

    // createMany does not return created rows, so re-fetch to obtain primary keys.
    // MIGRATION_NOTE: SQLAlchemy returned populated objects after commit; Prisma's
    // createMany does not, hence this fetch. Ordering is not guaranteed important here.
    const products = await tx.product.findMany();

    // --- Generate inventory for products ---
    const inventoryInputs: Prisma.InventoryCreateManyInput[] = products.map((product) => ({
      productId: product.id,
      quantity: randomInt(0, 100),
      lowStockThreshold: randomInt(5, 20),
    }));
    await tx.inventory.createMany({ data: inventoryInputs });

    // --- Generate sales data ---
    const now = new Date();
    const saleInputs: Prisma.SaleCreateManyInput[] = [];
    for (let i = 0; i < numSales; i += 1) {
      const product = randomChoice(products);
      const quantity = randomInt(1, 5);
      const saleDate = subtractDays(now, randomInt(0, 365));

      saleInputs.push({
        productId: product.id,
        quantity,
        unitPrice: product.price,
        totalAmount: round2(quantity * Number(product.price)),
        saleDate,
      });
    }
    await tx.sale.createMany({ data: saleInputs });

    // --- Generate revenue tracking data (12 months) ---
    const revenueInputs: Prisma.RevenueTrackingCreateManyInput[] = [];
    for (let i = 0; i < 12; i += 1) {
      const monthStart = subtractDays(now, 30 * (i + 1));
      const monthEnd = addDays(monthStart, 30);
      const revenue = randomFloat(10000, 50000);

      const categoryBreakdown: Record<string, number> = {};
      for (const cat of CATEGORIES) {
        categoryBreakdown[cat] = round2(revenue * randomFloat(0.1, 0.3));
      }

      revenueInputs.push({
        periodType: 'monthly',
        periodStart: toDateOnly(monthStart),
        periodEnd: toDateOnly(monthEnd),
        totalRevenue: round2(revenue),
        // MIGRATION_NOTE: Assumes a Json column. If schema.prisma declares this as String,
        // wrap with JSON.stringify(categoryBreakdown).
        categoryBreakdown,
      });
    }
    await tx.revenueTracking.createMany({ data: revenueInputs });
  });
}

// MIGRATION_NOTE: The debate suggested a Django management command. The Node equivalent is a
// CLI entrypoint. When run directly (e.g. `ts-node src/app/utils/data_generator.ts`) this
// executes the seeder and exits. Wire this to an npm script like `"seed": "ts-node ..."`.
if (require.main === module) {
  generateDemoData()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('Demo data generated successfully.');
      return defaultPrisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Failed to generate demo data:', err);
      await defaultPrisma.$disconnect();
      process.exit(1);
    });
}

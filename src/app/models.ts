// src/app/models.ts
// Migrated from app/models.py (SQLAlchemy ORM models for the product/inventory/sales/
// revenue domain) to idiomatic Node.js/TypeScript.
//
// MIGRATION_NOTE: The source defines the data layer with SQLAlchemy's Declarative Base.
// In this Node.js stack we use Prisma as the ORM (consistent with the already-migrated
// database.ts / crud.ts which use a shared Prisma client). The canonical source of truth
// for the database schema therefore becomes `prisma/schema.prisma` (see the schema block
// embedded below for review). This file complements that by exporting TypeScript types
// representing each model plus its relations, so the rest of the app can reference strong
// types without importing Prisma's generated client everywhere.
//
// MIGRATION_NOTE: SQLAlchemy column types map to Prisma as follows:
//   Integer            -> Int
//   String(n)          -> String  (length is not enforced by Prisma at the type level;
//                                  use @db.VarChar(n) in schema.prisma to preserve it)
//   Text               -> String  (@db.Text)
//   Numeric(p, s)      -> Decimal (@db.Decimal(p, s)) — represented here as Prisma.Decimal.
//                         As established in schemas.ts, JS has no native Decimal; Prisma's
//                         Decimal (decimal.js) preserves precision. We surface it as the
//                         `Decimal` type alias below.
//   DateTime           -> DateTime
//   JSON               -> Json
//   Enum(...)          -> a Prisma enum / TS string-literal union
//
// MIGRATION_NOTE: Custom primary key names (product_id, inventory_id, sale_id, tracking_id,
// history_id) are preserved via @id on those fields in schema.prisma. Explicit
// __tablename__ values are preserved via @@map on each Prisma model.
//
// MIGRATION_NOTE: Timestamp semantics:
//   created_at: default=datetime.utcnow -> @default(now()) in Prisma.
//   updated_at: default + onupdate=datetime.utcnow -> @default(now()) @updatedAt.
//   NOTE the subtle difference: SQLAlchemy's onupdate fires on ORM UPDATE; Prisma's
//   @updatedAt updates on every Prisma update call. Verify this matches intended behavior.
//   Source used naive UTC (datetime.utcnow); Prisma stores UTC DateTime — confirm that
//   downstream code treats all timestamps as UTC.
//
// MIGRATION_NOTE: index=True on the primary key columns is redundant — Prisma indexes
// primary keys automatically, so no explicit @@index is generated for them.
//
// ---------------------------------------------------------------------------------------
// REVIEW: Corresponding prisma/schema.prisma definitions (place these in your schema file):
//
// enum PeriodType {
//   daily
//   weekly
//   monthly
//   annual
// }
//
// model Product {
//   product_id  Int       @id @default(autoincrement())
//   name        String    @db.VarChar(255)
//   description String?   @db.Text
//   price       Decimal   @db.Decimal(10, 2)
//   category    String    @db.VarChar(100)
//   created_at  DateTime  @default(now())
//   updated_at  DateTime  @default(now()) @updatedAt
//   inventory   Inventory?
//   sales       Sale[]
//   history     InventoryHistory[]
//   @@map("products")
// }
//
// model Inventory {
//   inventory_id        Int       @id @default(autoincrement())
//   product_id          Int       @unique
//   quantity            Int       @default(0)
//   low_stock_threshold Int?      @default(10)
//   last_restocked      DateTime?
//   product             Product   @relation(fields: [product_id], references: [product_id])
//   @@map("inventory")
// }
//
// model Sale {
//   sale_id      Int      @id @default(autoincrement())
//   product_id   Int
//   quantity     Int
//   unit_price   Decimal  @db.Decimal(10, 2)
//   total_amount Decimal  @db.Decimal(10, 2)
//   sale_date    DateTime @default(now())
//   product      Product  @relation(fields: [product_id], references: [product_id])
//   @@map("sales")
// }
//
// model RevenueTracking {
//   tracking_id        Int        @id @default(autoincrement())
//   period_type        PeriodType
//   period_start       DateTime
//   period_end         DateTime
//   total_revenue      Decimal    @db.Decimal(15, 2)
//   category_breakdown Json?
//   created_at         DateTime   @default(now())
//   @@map("revenue_tracking")
// }
//
// model InventoryHistory {
//   history_id        Int      @id @default(autoincrement())
//   product_id        Int
//   previous_quantity Int
//   new_quantity      Int
//   change_reason     String   @db.VarChar(255)
//   changed_at        DateTime @default(now())
//   product           Product  @relation(fields: [product_id], references: [product_id])
//   @@map("inventory_history")
// }
// ---------------------------------------------------------------------------------------

import { Prisma } from '@prisma/client';

/**
 * Decimal type alias. Prisma represents Numeric/Decimal columns with its own Decimal
 * implementation (backed by decimal.js) to preserve monetary precision, mirroring the
 * Pydantic `Decimal` usage noted in schemas.ts.
 */
export type Decimal = Prisma.Decimal;

/**
 * Allowed values for RevenueTracking.period_type.
 * MIGRATION_NOTE: SQLAlchemy's named Enum("daily", ...) becomes a string-literal union here
 * (and a Prisma enum `PeriodType` in schema.prisma).
 */
export const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'annual'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

// ---------------------------------------------------------------------------------------
// Core model types (scalar fields only) — mirror the SQLAlchemy column definitions.
// ---------------------------------------------------------------------------------------

export interface Product {
  product_id: number;
  name: string;
  /** Maps to SQLAlchemy Text column (nullable). */
  description: string | null;
  price: Decimal;
  category: string;
  created_at: Date;
  updated_at: Date;
}

export interface Inventory {
  inventory_id: number;
  product_id: number;
  quantity: number;
  /** default=10 in source; nullable since no NOT NULL constraint was declared. */
  low_stock_threshold: number | null;
  last_restocked: Date | null;
}

export interface Sale {
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: Decimal;
  total_amount: Decimal;
  sale_date: Date;
}

export interface RevenueTracking {
  tracking_id: number;
  period_type: PeriodType;
  period_start: Date;
  period_end: Date;
  total_revenue: Decimal;
  /**
   * JSON column for semi-structured category breakdown data (nullable).
   * MIGRATION_NOTE: Source used SQLAlchemy JSON. Shape is unconstrained; refine if a
   * concrete structure is known.
   */
  category_breakdown: Prisma.JsonValue | null;
  created_at: Date;
}

export interface InventoryHistory {
  history_id: number;
  product_id: number;
  previous_quantity: number;
  new_quantity: number;
  change_reason: string;
  changed_at: Date;
}

// ---------------------------------------------------------------------------------------
// Relation-augmented types — equivalent to SQLAlchemy's relationship() back_populates.
// MIGRATION_NOTE: In SQLAlchemy these relations are lazy-loaded attributes. With Prisma,
// relations are only present when explicitly `include`d in a query. These *WithRelations
// types model the fully-included shape; use them where a query includes the relations.
// ---------------------------------------------------------------------------------------

export interface ProductWithRelations extends Product {
  /** One-to-one (SQLAlchemy uselist=False -> Prisma optional one-to-one). */
  inventory: Inventory | null;
  /** One-to-many: Product -> Sale[]. */
  sales: Sale[];
  /** One-to-many: Product -> InventoryHistory[]. */
  history: InventoryHistory[];
}

export interface InventoryWithRelations extends Inventory {
  product: Product;
}

export interface SaleWithRelations extends Sale {
  product: Product;
}

export interface InventoryHistoryWithRelations extends InventoryHistory {
  product: Product;
}

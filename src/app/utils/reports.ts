// src/app/utils/reports.ts
// Migrated from app/utils/reports.py (SQLAlchemy-based revenue reporting utilities) to
// idiomatic Node.js/TypeScript.
//
// MIGRATION_NOTE: The migration debate notes assumed a Django target. This project's actual
// data layer uses **Prisma** (see prisma/schema.prisma referenced from app/models.ts,
// database.ts and crud.ts). Therefore the SQLAlchemy aggregation queries are migrated to
// Prisma `groupBy` / `aggregate` calls using the shared PrismaClient. The implicit
// `.join(models.Product)` becomes a relation traversal: Prisma cannot group by a field on a
// related model directly, so we fetch the Sales joined with their Product (select category)
// and aggregate in application code. This preserves the exact business logic while being
// idiomatic for Prisma.
//
// MIGRATION_NOTE: SQLAlchemy `extract('month'|'quarter', sale_date)` is computed in JS from
// the JavaScript Date (`getMonth()+1`, `Math.floor(month/3)` for quarter) since Prisma does
// not expose a portable date-part extraction in groupBy.
//
// MIGRATION_NOTE: The original `generate_revenue_report` has a latent bug in the monthly
// branch: it uses `args[0].year` and `args[1].month` (two date arguments) while daily/weekly/
// annual use a single arg. The original calling convention is preserved here exactly.
//
// MIGRATION_NOTE: Python's Decimal/None handling (`item.total_revenue or 0`) is preserved:
// Prisma `_sum` returns null for empty aggregates, which we coerce with `?? 0`.

import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryBreakdown {
  revenue: number;
  transactions: number;
  units_sold: number;
}

export interface FormattedReport {
  period_type: string;
  period_start: Date;
  period_end: Date;
  total_revenue: number;
  category_breakdown: Record<string, CategoryBreakdown>;
}

export interface PeriodBucket {
  total_revenue: number;
  categories: Record<string, CategoryBreakdown>;
}

export interface MonthlyReport {
  period_type: 'monthly';
  year: number;
  monthly_breakdown: Record<number, PeriodBucket>;
  total_revenue: number;
}

export interface AnnualReport {
  period_type: 'annual';
  year: number;
  quarterly_breakdown: Record<number, PeriodBucket>;
  total_revenue: number;
  category_totals: Record<string, number>;
}

export type RevenueReport = FormattedReport | MonthlyReport | AnnualReport;

// Internal shape of an aggregated row (mirrors the SQLAlchemy labelled columns).
interface AggregatedRow {
  category: string;
  total_revenue: number;
  total_transactions: number;
  total_units: number;
  month?: number;
  quarter?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches sales within [start, end) (or inclusive depending on the caller) joined with their
 * product category, then aggregates revenue/transactions/units grouped by category and an
 * optional date-part (month or quarter).
 *
 * MIGRATION_NOTE: replaces the SQLAlchemy db.query(...).join(Product).filter(...).group_by(...)
 * chain. Aggregation is done in application code because Prisma's groupBy cannot group on a
 * related model's column.
 */
async function aggregateSales(
  db: PrismaClient,
  start: Date,
  end: Date,
  options: { inclusiveEnd?: boolean; datePart?: 'month' | 'quarter' } = {},
): Promise<AggregatedRow[]> {
  const { inclusiveEnd = false, datePart } = options;

  const sales = await db.sale.findMany({
    where: {
      saleDate: inclusiveEnd
        ? { gte: start, lte: end }
        : { gte: start, lt: end },
    },
    select: {
      totalAmount: true,
      quantity: true,
      saleDate: true,
      product: { select: { category: true } },
    },
  });

  // Group by (category[, datePart]) preserving SQL aggregation semantics.
  const buckets = new Map<string, AggregatedRow>();

  for (const sale of sales) {
    const category = sale.product.category;

    let partValue: number | undefined;
    if (datePart === 'month') {
      partValue = sale.saleDate.getMonth() + 1; // 1..12
    } else if (datePart === 'quarter') {
      partValue = Math.floor(sale.saleDate.getMonth() / 3) + 1; // 1..4
    }

    const key = datePart ? `${category}|${partValue}` : category;

    let row = buckets.get(key);
    if (!row) {
      row = {
        category,
        total_revenue: 0,
        total_transactions: 0,
        total_units: 0,
        ...(datePart === 'month' ? { month: partValue } : {}),
        ...(datePart === 'quarter' ? { quarter: partValue } : {}),
      };
      buckets.set(key, row);
    }

    // totalAmount may be a Prisma.Decimal; coerce to number. null guarded with ?? 0.
    row.total_revenue += Number(sale.totalAmount ?? 0);
    row.total_transactions += 1;
    row.total_units += Number(sale.quantity ?? 0);
  }

  return Array.from(buckets.values());
}

/** Returns datetime at the start of the given day (00:00:00.000). */
function startOfDay(day: Date): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns datetime at the end of the given day (23:59:59.999) — mirrors datetime.max.time(). */
function endOfDay(day: Date): Date {
  const d = new Date(day);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

export async function dailyRevenue(db: PrismaClient, day: Date): Promise<FormattedReport> {
  const start = startOfDay(day);
  const end = endOfDay(day);

  const result = await aggregateSales(db, start, end, { inclusiveEnd: true });
  return formatReport(result, 'daily', start, end);
}

export async function weeklyRevenue(
  db: PrismaClient,
  startDate: Date,
): Promise<FormattedReport> {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const start = startOfDay(startDate);
  const end = endOfDay(endDate);

  const result = await aggregateSales(db, start, end, { inclusiveEnd: true });
  return formatReport(result, 'weekly', start, end);
}

/**
 * Calculate monthly revenue for a specific year and optional month.
 * When `month` is omitted/undefined the full year is broken down by month.
 */
export async function monthlyRevenue(
  db: PrismaClient,
  year: number,
  month?: number,
): Promise<MonthlyReport | FormattedReport> {
  // Note: JS Date months are 0-based; (month - 1) when month provided, else month 0 (January).
  const startDate = new Date(year, month ? month - 1 : 0, 1);

  let endDate: Date;
  if (month) {
    endDate = month < 12 ? new Date(year, month, 1) : new Date(year + 1, 0, 1);
  } else {
    endDate = new Date(year + 1, 0, 1);
  }

  const results = await aggregateSales(db, startDate, endDate, { datePart: 'month' });

  if (!month) {
    const monthlyData: Record<number, PeriodBucket> = {};
    for (let monthNum = 1; monthNum <= 12; monthNum++) {
      monthlyData[monthNum] = { total_revenue: 0, categories: {} };
    }

    for (const row of results) {
      const monthNum = Number(row.month);
      monthlyData[monthNum].total_revenue += Number(row.total_revenue ?? 0);
      monthlyData[monthNum].categories[row.category] = {
        revenue: Number(row.total_revenue ?? 0),
        transactions: row.total_transactions,
        units_sold: row.total_units,
      };
    }

    const totalRevenue = Object.values(monthlyData).reduce(
      (acc, m) => acc + m.total_revenue,
      0,
    );

    return {
      period_type: 'monthly',
      year,
      monthly_breakdown: monthlyData,
      total_revenue: totalRevenue,
    };
  }

  return formatReport(results, 'monthly', startDate, endDate);
}

/** Calculate annual revenue for a specific year, broken down by quarter. */
export async function annualRevenue(db: PrismaClient, year: number): Promise<AnnualReport> {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year + 1, 0, 1);

  const results = await aggregateSales(db, startDate, endDate, { datePart: 'quarter' });

  const quarterlyData: Record<number, PeriodBucket> = {};
  for (let quarter = 1; quarter <= 4; quarter++) {
    quarterlyData[quarter] = { total_revenue: 0, categories: {} };
  }

  for (const row of results) {
    const quarterNum = Number(row.quarter);
    quarterlyData[quarterNum].total_revenue += Number(row.total_revenue ?? 0);
    quarterlyData[quarterNum].categories[row.category] = {
      revenue: Number(row.total_revenue ?? 0),
      transactions: row.total_transactions,
      units_sold: row.total_units,
    };
  }

  const totalRevenue = Object.values(quarterlyData).reduce(
    (acc, q) => acc + q.total_revenue,
    0,
  );

  // Build category_totals: for every category appearing in any quarter, sum its revenue.
  const allCategories = new Set<string>();
  for (const q of Object.values(quarterlyData)) {
    for (const cat of Object.keys(q.categories)) {
      allCategories.add(cat);
    }
  }

  const categoryTotals: Record<string, number> = {};
  for (const category of allCategories) {
    categoryTotals[category] = Object.values(quarterlyData).reduce((acc, q) => {
      return acc + (category in q.categories ? q.categories[category].revenue : 0);
    }, 0);
  }

  return {
    period_type: 'annual',
    year,
    quarterly_breakdown: quarterlyData,
    total_revenue: totalRevenue,
    category_totals: categoryTotals,
  };
}

/**
 * Dispatches to the correct report generator based on `periodType`.
 *
 * MIGRATION_NOTE: The original monthly branch used `args[0].year` and `args[1].month`
 * (two Date arguments), while every other branch uses a single Date argument. This quirky
 * calling convention is preserved exactly as in the source.
 */
export async function generateRevenueReport(
  db: PrismaClient,
  periodType: string,
  ...args: Date[]
): Promise<RevenueReport | undefined> {
  switch (periodType) {
    case 'daily':
      return dailyRevenue(db, args[0]);
    case 'weekly':
      return weeklyRevenue(db, args[0]);
    case 'monthly':
      // Preserves the original (buggy) two-argument convention: year from args[0],
      // month from args[1].
      return monthlyRevenue(db, args[0].getFullYear(), args[1].getMonth() + 1);
    case 'annual':
      // eslint-disable-next-line no-console
      console.log(args); // mirrors the original `print(args)`
      return annualRevenue(db, args[0].getFullYear());
    default:
      return undefined;
  }
}

/** Builds a flat category breakdown report for a single period window. */
export function formatReport(
  data: AggregatedRow[],
  periodType: string,
  start: Date,
  end: Date,
): FormattedReport {
  const categories: Record<string, CategoryBreakdown> = {};
  for (const item of data) {
    categories[item.category] = {
      revenue: item.total_revenue ? Number(item.total_revenue) : 0,
      transactions: item.total_transactions,
      units_sold: item.total_units,
    };
  }

  const totalRevenue = data.reduce((acc, item) => acc + (item.total_revenue || 0), 0);

  return {
    period_type: periodType,
    period_start: start,
    period_end: end,
    total_revenue: Number(totalRevenue),
    category_breakdown: categories,
  };
}

// ---------------------------------------------------------------------------
// Pure utility: percentage change
// ---------------------------------------------------------------------------

type NumericLike = number | string;
type PercentInput = NumericLike | Record<string, NumericLike>;

function isRecord(value: unknown): value is Record<string, NumericLike> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Calculate percentage change between two values or dictionaries of values, replacing
 * non-JSON-safe values like `inf` with null.
 *
 * MIGRATION_NOTE: The original Python used a walrus operator with `... is not None or True`
 * which is always truthy, so every key from the union of both dicts is always included
 * (with the value being either the rounded change or null). This behavior is preserved here:
 * the filter is effectively a no-op and every category appears in the result.
 */
export function calculatePercentageChange(
  baseData: PercentInput,
  compareData: PercentInput,
  precision = 2,
): number | null | Record<string, number | null> {
  const safeDivide = (current: number, previous: number): number | null => {
    try {
      if (previous === 0) {
        if (current === 0) {
          return 0.0;
        }
        return null; // avoids Infinity
      }
      const change = ((current - previous) / previous) * 100;
      if (!Number.isFinite(change)) {
        return null;
      }
      return change;
    } catch {
      return null;
    }
  };

  const round = (value: number, p: number): number => {
    const factor = Math.pow(10, p);
    return Math.round(value * factor) / factor;
  };

  if (isRecord(baseData) && isRecord(compareData)) {
    const result: Record<string, number | null> = {};
    const categories = new Set<string>([
      ...Object.keys(baseData),
      ...Object.keys(compareData),
    ]);

    for (const category of categories) {
      const current = Number(compareData[category] ?? 0);
      const previous = Number(baseData[category] ?? 0);
      const change = safeDivide(current, previous);
      // Original `... is not None or True` always includes the key.
      result[category] = change !== null ? round(change, precision) : null;
    }

    return result;
  }

  // Scalar branch.
  const baseVal = Number(baseData);
  const compareVal = Number(compareData);
  if (Number.isNaN(baseVal) || Number.isNaN(compareVal)) {
    return null;
  }
  const change = safeDivide(compareVal, baseVal);
  return change !== null ? round(change, precision) : null;
}

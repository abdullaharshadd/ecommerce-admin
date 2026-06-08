// src/app/endpoints/analytics.ts
// Migrated from app/endpoints/analytics.py (FastAPI analytics router) to idiomatic
// Node.js/TypeScript using Express + Zod for validation.
//
// MIGRATION_NOTE: FastAPI's `Depends(get_db)` injection is dropped. As established in the
// already-migrated database.ts, Prisma manages connections internally; the report functions
// in app/utils/reports.ts (to be migrated separately) should use the shared Prisma client
// directly rather than receiving a `db` session.
//
// MIGRATION_NOTE: `generate_revenue_report` has an overloaded/inconsistent signature in the
// source. It is invoked as:
//   (db, "daily", target_date)
//   (db, "weekly", start_date)
//   (db, "monthly", year, month)
//   (db, "annual", year)
//   (db, period_type, base_start, base_end)   // comparison: range of two dates
// The exact argument ordering is preserved below (minus the dropped `db`). The real
// implementation lives in app/utils/reports.ts and MUST be reviewed/migrated separately.
//
// MIGRATION_NOTE: FastAPI auto-parsed `Optional[date]` query params and 422'd on bad input.
// We reproduce that with Zod coercion schemas, returning 400 on invalid input via the
// centralized error middleware (consistent { error, details } JSON shape).

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  generateRevenueReport,
  calculatePercentageChange,
} from '../utils/reports';

export const analyticsRouter = Router();

/**
 * Parses a YYYY-MM-DD style date string into a Date.
 * Mirrors FastAPI's `date` query-param coercion.
 */
const dateSchema = z.coerce.date();
const optionalDateSchema = z.coerce.date().optional();

/** Returns today's date with the time component zeroed (date-only semantics). */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Returns a new Date `days` before the given date. */
function minusDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Helper to wrap async route handlers so thrown errors propagate to the
 * centralized Express error middleware.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// GET /analytics/revenue/daily
const dailyQuerySchema = z.object({
  target_date: optionalDateSchema,
});

analyticsRouter.get(
  '/revenue/daily',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = dailyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      });
    }

    const targetDate = parsed.data.target_date ?? today();
    const report = await generateRevenueReport('daily', targetDate);
    return res.json(report);
  })
);

// GET /analytics/revenue/weekly
const weeklyQuerySchema = z.object({
  start_date: optionalDateSchema,
});

analyticsRouter.get(
  '/revenue/weekly',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = weeklyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      });
    }

    const startDate = parsed.data.start_date ?? minusDays(today(), 7);
    const report = await generateRevenueReport('weekly', startDate);
    return res.json(report);
  })
);

// GET /analytics/revenue/monthly
// `year` is required, `month` optional — matching the source signature.
const monthlyQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

analyticsRouter.get(
  '/revenue/monthly',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = monthlyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      });
    }

    // Preserve original arg order: (type, year, month)
    const report = await generateRevenueReport(
      'monthly',
      parsed.data.year,
      parsed.data.month
    );
    return res.json(report);
  })
);

// GET /analytics/revenue/annual
const annualQuerySchema = z.object({
  year: z.coerce.number().int(),
});

analyticsRouter.get(
  '/revenue/annual',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = annualQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten(),
      });
    }

    const report = await generateRevenueReport('annual', parsed.data.year);
    return res.json(report);
  })
);

// GET /analytics/comparison
const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'annual'] as const;

const comparisonQuerySchema = z.object({
  period_type: z.enum(PERIOD_TYPES, {
    // Mirror the source's explicit 400 "Invalid period type".
    errorMap: () => ({ message: 'Invalid period type' }),
  }),
  base_start: dateSchema,
  base_end: dateSchema,
  compare_start: dateSchema,
  compare_end: dateSchema,
});

analyticsRouter.get(
  '/comparison',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = comparisonQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // The source raised HTTPException(400, "Invalid period type") for a bad
      // period_type; here all comparison query validation failures return 400.
      return res.status(400).json({
        error: 'Invalid period type',
        details: parsed.error.flatten(),
      });
    }

    const { period_type, base_start, base_end, compare_start, compare_end } =
      parsed.data;

    // Preserve the comparison-specific arg ordering: (type, start, end) per range.
    const baseData = await generateRevenueReport(
      period_type,
      base_start,
      base_end
    );
    const compareData = await generateRevenueReport(
      period_type,
      compare_start,
      compare_end
    );

    return res.json({
      base_period: baseData,
      comparison_period: compareData,
      percentage_change: calculatePercentageChange(baseData, compareData),
    });
  })
);

export default analyticsRouter;

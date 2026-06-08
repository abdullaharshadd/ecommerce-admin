import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  generateRevenueReport,
  calculatePercentageChange,
  RevenueReport,
} from '../utils/reports';

/**
 * Analytics endpoints exposing revenue reports (daily, weekly, monthly,
 * annual) and a cross-period comparison.
 *
 * MIGRATION_NOTE: The source was a FastAPI APIRouter using SQLAlchemy with a
 * `Depends(get_db)` session. Consistent with the already-migrated `app/crud.ts`
 * and `app/database.ts`, this has been migrated to an Express Router using
 * Prisma. The DB session is injected via the factory function below rather than
 * per-request dependency injection.
 *
 * MIGRATION_NOTE: `app.models` and `app.schemas` were imported but unused in the
 * source — they have been dropped.
 *
 * MIGRATION_NOTE: No authentication/permission checks existed in the source, so
 * none are added here. If the target requires auth, add middleware explicitly.
 */

/**
 * MIGRATION_NOTE: The Python `generate_revenue_report` was overloaded with
 * variable positional signatures:
 *   (db, 'daily', target_date)
 *   (db, 'weekly', start_date)
 *   (db, 'monthly', year, month)
 *   (db, 'annual', year)
 *   (db, period_type, start, end)
 * The migrated `generateRevenueReport` in `../utils/reports` is expected to
 * accept (prisma, periodType, ...args) and dispatch accordingly. Verify that
 * utility signature matches when migrating `app/utils/reports.py`.
 */

const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'annual'] as const;

// Coerce ISO date strings (YYYY-MM-DD) from query params into Date objects.
const dateSchema = z.coerce.date();
const optionalDateSchema = z.coerce.date().optional();

const dailyQuerySchema = z.object({
  target_date: optionalDateSchema,
});

const weeklyQuerySchema = z.object({
  start_date: optionalDateSchema,
});

const monthlyQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().optional(),
});

const annualQuerySchema = z.object({
  year: z.coerce.number().int(),
});

const comparisonQuerySchema = z.object({
  period_type: z.enum(PERIOD_TYPES),
  base_start: dateSchema,
  base_end: dateSchema,
  compare_start: dateSchema,
  compare_end: dateSchema,
});

/**
 * Returns today's date with the time portion zeroed out (UTC), matching
 * Python's `date.today()` semantics (a date without time).
 */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function subtractDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

/**
 * Factory that builds the analytics router with an injected PrismaClient.
 * Mount under the application root; routes are prefixed with `/analytics`.
 */
export function createAnalyticsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // GET /analytics/revenue/daily
  router.get(
    '/analytics/revenue/daily',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { target_date } = dailyQuerySchema.parse(req.query);
        const targetDate = target_date ?? today();
        const report = await generateRevenueReport(prisma, 'daily', targetDate);
        res.json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /analytics/revenue/weekly
  router.get(
    '/analytics/revenue/weekly',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { start_date } = weeklyQuerySchema.parse(req.query);
        const startDate = start_date ?? subtractDays(today(), 7);
        const report = await generateRevenueReport(prisma, 'weekly', startDate);
        res.json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /analytics/revenue/monthly
  router.get(
    '/analytics/revenue/monthly',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { year, month } = monthlyQuerySchema.parse(req.query);
        const report = await generateRevenueReport(prisma, 'monthly', year, month);
        res.json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /analytics/revenue/annual
  router.get(
    '/analytics/revenue/annual',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { year } = annualQuerySchema.parse(req.query);
        const report = await generateRevenueReport(prisma, 'annual', year);
        res.json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /analytics/comparison
  router.get(
    '/analytics/comparison',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          period_type,
          base_start,
          base_end,
          compare_start,
          compare_end,
        } = comparisonQuerySchema.parse(req.query);

        const baseData: RevenueReport = await generateRevenueReport(
          prisma,
          period_type,
          base_start,
          base_end,
        );
        const compareData: RevenueReport = await generateRevenueReport(
          prisma,
          period_type,
          compare_start,
          compare_end,
        );

        res.json({
          base_period: baseData,
          comparison_period: compareData,
          percentage_change: calculatePercentageChange(baseData, compareData),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export default createAnalyticsRouter;

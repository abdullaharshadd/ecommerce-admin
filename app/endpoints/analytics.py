from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import Optional
from app import models, schemas
from app.database import get_db
from app.utils.reports import generate_revenue_report, calculate_percentage_change

router = APIRouter(prefix="/analytics", tags=["analytics"])

@router.get("/revenue/daily")
async def get_daily_revenue(
    target_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    if not target_date:
        target_date = date.today()
    return generate_revenue_report(db, "daily", target_date)

@router.get("/revenue/weekly")
async def get_weekly_revenue(
    start_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    if not start_date:
        start_date = date.today() - timedelta(days=7)
    return generate_revenue_report(db, "weekly", start_date)

@router.get("/revenue/monthly")
async def get_monthly_revenue(
    year: int,
    month: Optional[int] = None,
    db: Session = Depends(get_db)
):
    return generate_revenue_report(db, "monthly", year, month)

@router.get("/revenue/annual")
async def get_annual_revenue(
    year: int,
    db: Session = Depends(get_db)
):
    return generate_revenue_report(db, "annual", year)

@router.get("/comparison")
async def compare_periods(
    period_type: str,
    base_start: date,
    base_end: date,
    compare_start: date,
    compare_end: date,
    db: Session = Depends(get_db)
):
    if period_type not in ["daily", "weekly", "monthly", "annual"]:
        raise HTTPException(status_code=400, detail="Invalid period type")
    
    base_data = generate_revenue_report(db, period_type, base_start, base_end)
    compare_data = generate_revenue_report(db, period_type, compare_start, compare_end)
    
    return {
        "base_period": base_data,
        "comparison_period": compare_data,
        "percentage_change": calculate_percentage_change(base_data, compare_data)
    }
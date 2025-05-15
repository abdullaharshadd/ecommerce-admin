from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case, and_
from decimal import Decimal, DivisionByZero
from typing import Dict, Union
from datetime import date, datetime, timedelta
from app import models

def generate_revenue_report(db: Session, period_type: str, *args):
    if period_type == "daily":
        return daily_revenue(db, args[0])
    elif period_type == "weekly":
        return weekly_revenue(db, args[0])
    elif period_type == "monthly":
        return monthly_revenue(db, args[0].year, args[1].month)
    elif period_type == "annual":
        print(args)
        return annual_revenue(db, args[0].year)

def daily_revenue(db: Session, day: date):
    start = datetime.combine(day, datetime.min.time())
    end = datetime.combine(day, datetime.max.time())
    
    result = db.query(
        func.sum(models.Sale.total_amount).label("total_revenue"),
        func.count(models.Sale.sale_id).label("total_transactions"),
        models.Product.category,
        func.sum(models.Sale.quantity).label("total_units")
    ).join(models.Product).filter(
        models.Sale.sale_date.between(start, end)
    ).group_by(models.Product.category).all()
    
    return format_report(result, "daily", start, end)

def weekly_revenue(db: Session, start_date: date):
    end_date = start_date + timedelta(days=6)
    start = datetime.combine(start_date, datetime.min.time())
    end = datetime.combine(end_date, datetime.max.time())
    
    result = db.query(
        func.sum(models.Sale.total_amount).label("total_revenue"),
        func.count(models.Sale.sale_id).label("total_transactions"),
        models.Product.category,
        func.sum(models.Sale.quantity).label("total_units")
    ).join(models.Product).filter(
        models.Sale.sale_date.between(start, end)
    ).group_by(models.Product.category).all()
    
    return format_report(result, "weekly", start, end)

def monthly_revenue(db: Session, year: int, month: int = None):
    """Calculate monthly revenue for a specific year and optional month"""
    start_date = datetime(year, month if month else 1, 1)
    
    if month:
        end_date = datetime(year, month + 1, 1) if month < 12 else datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year + 1, 1, 1)
    
    results = db.query(
        func.sum(models.Sale.total_amount).label("total_revenue"),
        func.count(models.Sale.sale_id).label("total_transactions"),
        models.Product.category,
        func.sum(models.Sale.quantity).label("total_units"),
        extract('month', models.Sale.sale_date).label("month")
    ).join(models.Product).filter(
        models.Sale.sale_date >= start_date,
        models.Sale.sale_date < end_date
    ).group_by(
        models.Product.category,
        extract('month', models.Sale.sale_date)
    ).all()
    
    # Format by month if no specific month requested
    if not month:
        monthly_data = {}
        for month_num in range(1, 13):
            monthly_data[month_num] = {
                "total_revenue": 0,
                "categories": {}
            }
        
        for row in results:
            month_num = int(row.month)
            monthly_data[month_num]["total_revenue"] += float(row.total_revenue or 0)
            monthly_data[month_num]["categories"][row.category] = {
                "revenue": float(row.total_revenue or 0),
                "transactions": row.total_transactions,
                "units_sold": row.total_units
            }
        
        return {
            "period_type": "monthly",
            "year": year,
            "monthly_breakdown": monthly_data,
            "total_revenue": sum(m["total_revenue"] for m in monthly_data.values())
        }
    else:
        return format_report(results, "monthly", start_date, end_date)

def annual_revenue(db: Session, year: int):
    """Calculate annual revenue for a specific year"""
    start_date = datetime(year, 1, 1)
    end_date = datetime(year + 1, 1, 1)
    
    results = db.query(
        func.sum(models.Sale.total_amount).label("total_revenue"),
        func.count(models.Sale.sale_id).label("total_transactions"),
        models.Product.category,
        func.sum(models.Sale.quantity).label("total_units"),
        extract('quarter', models.Sale.sale_date).label("quarter")
    ).join(models.Product).filter(
        models.Sale.sale_date >= start_date,
        models.Sale.sale_date < end_date
    ).group_by(
        models.Product.category,
        extract('quarter', models.Sale.sale_date)
    ).all()
    
    # Format by quarter
    quarterly_data = {}
    for quarter in range(1, 5):
        quarterly_data[quarter] = {
            "total_revenue": 0,
            "categories": {}
        }
    
    for row in results:
        quarter_num = int(row.quarter)
        quarterly_data[quarter_num]["total_revenue"] += float(row.total_revenue or 0)
        quarterly_data[quarter_num]["categories"][row.category] = {
            "revenue": float(row.total_revenue or 0),
            "transactions": row.total_transactions,
            "units_sold": row.total_units
        }
    
    return {
        "period_type": "annual",
        "year": year,
        "quarterly_breakdown": quarterly_data,
        "total_revenue": sum(q["total_revenue"] for q in quarterly_data.values()),
        "category_totals": {
            category: sum(
                q["categories"][category]["revenue"] 
                for q in quarterly_data.values() 
                if category in q["categories"]
            )
            for category in set(
                cat 
                for q in quarterly_data.values() 
                for cat in q["categories"]
            )
        }
    }

def format_report(data, period_type, start, end):
    categories = {item.category: {
        "revenue": float(item.total_revenue) if item.total_revenue else 0,
        "transactions": item.total_transactions,
        "units_sold": item.total_units
    } for item in data}
    
    total_revenue = sum(item.total_revenue or 0 for item in data)
    
    return {
        "period_type": period_type,
        "period_start": start,
        "period_end": end,
        "total_revenue": float(total_revenue),
        "category_breakdown": categories
    }

def calculate_percentage_change(
    base_data: Union[float, Decimal, Dict[str, float]],
    compare_data: Union[float, Decimal, Dict[str, float]],
    precision: int = 2
) -> Union[float, Dict[str, Union[float, None]]]:
    """
    Calculate percentage change between two values or dictionaries of values,
    replacing non-JSON-safe values like `inf` with None.
    """

    def _safe_divide(current, previous):
        try:
            if previous == 0:
                if current == 0:
                    return 0.0
                return None  # avoids float('inf')
            return ((current - previous) / previous) * 100
        except (ZeroDivisionError, TypeError, ValueError):
            return None

    if isinstance(base_data, dict) and isinstance(compare_data, dict):
        return {
            category: (
                round(change, precision) if change is not None else None
            )
            for category in set(base_data) | set(compare_data)
            if (change := _safe_divide(
                compare_data.get(category, 0),
                base_data.get(category, 0)
            )) is not None or True
        }
    else:
        try:
            base_val = float(base_data)
            compare_val = float(compare_data)
            change = _safe_divide(compare_val, base_val)
            return round(change, precision) if change is not None else None
        except (TypeError, ValueError):
            return None

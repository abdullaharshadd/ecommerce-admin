from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
from .. import models, schemas, crud
from ..database import get_db

router = APIRouter(prefix="/sales", tags=["sales"])

@router.post("/", response_model=schemas.Sale)
def record_sale(sale: schemas.SaleCreate, db: Session = Depends(get_db)):
    return crud.create_sale(db=db, sale=sale)

@router.get("/", response_model=List[schemas.Sale])
def read_sales(
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    product_id: Optional[int] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return crud.get_sales(
        db,
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        product_id=product_id,
        category=category
    )

@router.get("/revenue/periodic")
def get_periodic_revenue(
    period: str,  # 'daily', 'weekly', 'monthly', 'annual'
    start_date: date,
    end_date: date,
    compare_with_previous: bool = False,
    db: Session = Depends(get_db)
):
    return crud.calculate_periodic_revenue(
        db,
        period=period,
        start_date=start_date,
        end_date=end_date,
        compare_with_previous=compare_with_previous
    )
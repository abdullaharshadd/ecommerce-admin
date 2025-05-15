from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas, crud
from ..database import get_db

router = APIRouter(prefix="/inventory", tags=["inventory"])

@router.get("/", response_model=List[schemas.Inventory])
def read_inventory(
    low_stock_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    if low_stock_only:
        return crud.get_low_stock_items(db, skip=skip, limit=limit)
    return crud.get_inventory(db, skip=skip, limit=limit)

@router.put("/{product_id}/update", response_model=schemas.Inventory)
def update_inventory(
    product_id: int,
    inventory_update: schemas.InventoryUpdate,
    db: Session = Depends(get_db)
):
    return crud.update_inventory(db=db, product_id=product_id, inventory_update=inventory_update)

@router.get("/history/{product_id}", response_model=List[schemas.InventoryHistory])
def get_inventory_history(
    product_id: int,
    days: int = 30,
    db: Session = Depends(get_db)
):
    return crud.get_inventory_history(db, product_id=product_id, days=days)
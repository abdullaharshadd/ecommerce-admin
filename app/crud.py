# SQLAlchemy
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, or_, and_

from app import models, schemas
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import List, Optional, Dict, Union

# Product CRUD Operations
def get_product(db: Session, product_id: int):
    return db.query(models.Product).filter(models.Product.product_id == product_id).first()

def get_products(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Product).offset(skip).limit(limit).all()

def create_product(db: Session, product: schemas.ProductCreate):
    db_product = models.Product(**product.dict())
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

def update_product(db: Session, product_id: int, product: schemas.ProductUpdate):
    db_product = get_product(db, product_id)
    if db_product:
        update_data = product.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_product, key, value)
        db_product.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_product)
    return db_product

def delete_product(db: Session, product_id: int):
    db_product = get_product(db, product_id)
    if db_product:
        db.delete(db_product)
        db.commit()
    return db_product

def get_inventory(
    db: Session, 
    skip: int = 0, 
    limit: int = 100,
    low_stock_only: bool = False
) -> List[models.Inventory]:
    """Get inventory with pagination support"""
    query = db.query(models.Inventory)
    
    if low_stock_only:
        query = query.filter(
            models.Inventory.quantity <= models.Inventory.low_stock_threshold
        )
    
    return query.offset(skip).limit(limit).all()

def update_inventory(db: Session, product_id: int, inventory_update: schemas.InventoryUpdate):
    """Update inventory for a specific product."""
    # First check if product exists
    product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not product:
        return {}
    
    # Then get associated inventory
    # Make sure to use .first() to get a single object, not a list
    db_inventory = db.query(models.Inventory).filter(models.Inventory.product_id == product_id).first()
    
    # Store the previous quantity before updating (if inventory exists)
    previous_quantity = 0
    if db_inventory:
        previous_quantity = db_inventory.quantity
    
    if not db_inventory:
        # Create new inventory if it doesn't exist
        db_inventory = models.Inventory(product_id=product_id, **inventory_update.dict())
        db.add(db_inventory)
    else:
        # Update existing inventory
        for key, value in inventory_update.dict().items():
            setattr(db_inventory, key, value)
    
    # Add history record
    history = models.InventoryHistory(
        product_id=product_id,
        previous_quantity=previous_quantity,  # Use the saved value
        new_quantity=inventory_update.quantity,
        change_reason="Manual update via API"
    )
    db.add(history)
    
    db.commit()
    db.refresh(db_inventory)
    return db_inventory

# Sale CRUD Operations
def create_sale(db: Session, sale: schemas.SaleCreate):
    # Get current product price
    product = get_product(db, sale.product_id)
    if not product:
        return None
        
    db_sale = models.Sale(
        product_id=sale.product_id,
        quantity=sale.quantity,
        unit_price=product.price,
        total_amount=sale.quantity * product.price
    )
    
    # Update inventory
    inventory = get_inventory(db, sale.product_id)
    if inventory:
        inventory.quantity -= sale.quantity
    
    db.add(db_sale)
    db.commit()
    db.refresh(db_sale)
    return db_sale

def get_sales(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    product_id: Optional[int] = None,
    category: Optional[str] = None  # Add this parameter
) -> List[models.Sale]:
    query = db.query(models.Sale)
    
    if start_date:
        query = query.filter(models.Sale.sale_date >= start_date)
    if end_date:
        query = query.filter(models.Sale.sale_date <= end_date)
    if product_id:
        query = query.filter(models.Sale.product_id == product_id)
    if category:  # Add this filter
        query = query.join(models.Product).filter(models.Product.category == category)
    
    return query.order_by(models.Sale.sale_date.desc()).offset(skip).limit(limit).all()

# Analytics Operations
def get_revenue_by_period(db: Session, period: str, start_date: datetime, end_date: datetime):
    return db.query(
        models.Sale.product_id,
        models.Product.category,
        models.Sale.total_amount
    ).join(models.Product).filter(
        models.Sale.sale_date.between(start_date, end_date)
    ).all()

def get_low_stock_items(db: Session, skip: int = 0, limit: int = 100, threshold: int = 10):
    return db.query(models.Inventory).join(models.Product).filter(
        models.Inventory.quantity <= models.Inventory.low_stock_threshold
    ).offset(skip).limit(limit).all()

# ======================
# INVENTORY HISTORY CRUD
# ======================

def get_inventory_history(
    db: Session, 
    product_id: Optional[int] = None,
    days: int = 30,
    skip: int = 0, 
    limit: int = 100
) -> List[models.InventoryHistory]:
    """Get inventory change history with filters"""
    query = db.query(models.InventoryHistory)
    
    if product_id:
        query = query.filter(models.InventoryHistory.product_id == product_id)
    
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    query = query.filter(models.InventoryHistory.changed_at >= cutoff_date)
    
    return query.order_by(
        models.InventoryHistory.changed_at.desc()
    ).offset(skip).limit(limit).all()

def record_inventory_change(
    db: Session,
    product_id: int,
    previous_quantity: int,
    new_quantity: int,
    change_reason: str
) -> models.InventoryHistory:
    """Create a new inventory history record"""
    if previous_quantity == new_quantity:
        return None  # No actual change
    
    db_history = models.InventoryHistory(
        product_id=product_id,
        previous_quantity=previous_quantity,
        new_quantity=new_quantity,
        change_reason=change_reason,
        changed_at=datetime.utcnow()
    )
    db.add(db_history)
    db.commit()
    db.refresh(db_history)
    return db_history

# ======================
# ENHANCED INVENTORY CRUD 
# ======================

def get_inventory_with_history(
    db: Session,
    product_id: int
) -> schemas.InventoryWithHistory:
    """Get inventory with its change history"""
    inventory = db.query(models.Inventory).filter(
        models.Inventory.product_id == product_id
    ).first()
    
    if not inventory:
        return None
    
    history = get_inventory_history(db, product_id=product_id)
    
    return {
        "inventory": inventory,
        "history": history
    }

# ======================
# MISSING PRODUCT CRUD
# ======================

def get_products_by_category(
    db: Session,
    category: str,
    skip: int = 0,
    limit: int = 100
) -> List[models.Product]:
    """Get products filtered by category"""
    return db.query(models.Product).filter(
        models.Product.category == category
    ).offset(skip).limit(limit).all()

def search_products(
    db: Session,
    search_term: str,
    skip: int = 0,
    limit: int = 100
) -> List[models.Product]:
    """Search products by name or description"""
    return db.query(models.Product).filter(
        models.Product.name.ilike(f"%{search_term}%") |
        models.Product.description.ilike(f"%{search_term}%")
    ).offset(skip).limit(limit).all()

# ======================
# MISSING ANALYTICS CRUD
# ======================

def get_category_revenue(
    db: Session,
    start_date: datetime,
    end_date: datetime
) -> List[schemas.CategoryRevenue]:
    """Get revenue breakdown by category"""
    return db.query(
        models.Product.category,
        func.sum(models.Sale.total_amount).label("revenue"),
        func.count(models.Sale.sale_id).label("transactions")
    ).join(models.Sale).filter(
        models.Sale.sale_date.between(start_date, end_date)
    ).group_by(models.Product.category).all()

# ======================
# BULK OPERATIONS
# ======================

def bulk_update_inventory(
    db: Session,
    updates: List[schemas.InventoryBulkUpdate]
) -> List[models.Inventory]:
    """Update multiple inventory items at once"""
    results = []
    for update in updates:
        inventory = db.query(models.Inventory).filter(
            models.Inventory.product_id == update.product_id
        ).first()
        
        if inventory:
            # Record history before updating
            record_inventory_change(
                db,
                product_id=update.product_id,
                previous_quantity=inventory.quantity,
                new_quantity=update.quantity,
                change_reason="Bulk update"
            )
            
            inventory.quantity = update.quantity
            inventory.last_restocked = datetime.utcnow()
            results.append(inventory)
    
    db.commit()
    return results
from typing import List, Optional, ForwardRef
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, validator, Field
from enum import Enum

# --------------------------
# ENUMS
# --------------------------

class PeriodType(str, Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    annual = "annual"

# --------------------------
# BASE MODELS (No relationships)
# --------------------------

class ProductBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    price: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)
    category: str = Field(..., max_length=100)

class InventoryBase(BaseModel):
    quantity: int = Field(..., ge=0)
    low_stock_threshold: int = Field(10, ge=0)

class SaleBase(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    unit_price: Decimal = Field(..., gt=0, max_digits=10, decimal_places=2)

class InventoryHistoryBase(BaseModel):
    previous_quantity: int
    new_quantity: int
    change_reason: str = Field(..., max_length=255)

# --------------------------
# CREATE SCHEMAS
# --------------------------

class ProductCreate(ProductBase):
    pass

class InventoryCreate(InventoryBase):
    product_id: int

class SaleCreate(SaleBase):
    pass

class InventoryHistoryCreate(InventoryHistoryBase):
    product_id: int

# --------------------------
# UPDATE SCHEMAS
# --------------------------

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    price: Optional[Decimal] = Field(None, gt=0, max_digits=10, decimal_places=2)
    category: Optional[str] = Field(None, max_length=100)

class InventoryUpdate(InventoryBase):
    pass

# --------------------------
# MODELS WITHOUT NESTED RELATIONSHIPS
# --------------------------

class InventorySimple(InventoryBase):
    inventory_id: int
    last_restocked: Optional[datetime]
    product_id: int

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }

class SaleSimple(SaleBase):
    sale_id: int
    total_amount: Decimal
    sale_date: datetime

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            Decimal: lambda v: float(v)
        }

class InventoryHistorySimple(InventoryHistoryBase):
    history_id: int
    changed_at: datetime
    product_id: int

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }

class ProductSimple(ProductBase):
    product_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            Decimal: lambda v: float(v)
        }

# --------------------------
# FULL MODELS WITH RELATIONSHIPS
# --------------------------

class Product(ProductSimple):
    inventory: Optional[InventorySimple] = None
    sales: List[SaleSimple] = []
    history: List[InventoryHistorySimple] = []

    @validator('created_at', 'updated_at', pre=True)
    def parse_dates(cls, v):
        if isinstance(v, str):
            return datetime.fromisoformat(v)
        return v

class Inventory(InventorySimple):
    product: ProductSimple

class Sale(SaleSimple):
    product: ProductSimple

class InventoryHistory(InventoryHistorySimple):
    product: ProductSimple

class RevenueReport(BaseModel):
    period_type: PeriodType
    period_start: date
    period_end: date
    total_revenue: Decimal
    category_breakdown: dict
    comparison_period: Optional[dict] = None

    class Config:
        orm_mode = True
        json_encoders = {
            date: lambda v: v.isoformat(),
            Decimal: lambda v: float(v)
        }

# --------------------------
# RESPONSE MODELS
# --------------------------

class ProductResponse(ProductSimple):
    inventory: Optional[InventorySimple] = None
    low_stock: Optional[bool] = None

    @validator('low_stock', always=True)
    def check_low_stock(cls, v, values):
        if 'inventory' in values and values['inventory']:
            return values['inventory'].quantity <= values['inventory'].low_stock_threshold
        return None

class InventoryStatus(BaseModel):
    product_id: int
    product_name: str
    current_stock: int
    threshold: int
    last_updated: datetime

    class Config:
        orm_mode = True

# --------------------------
# UTILITY MODELS
# --------------------------

class PaginatedResponse(BaseModel):
    items: List[Product]
    total: int
    page: int
    pages: int

class InventoryWithHistory(BaseModel):
    """Combined inventory with its change history"""
    inventory: 'Inventory'
    history: List['InventoryHistory']
    
    class Config:
        orm_mode = True

class CategoryRevenue(BaseModel):
    """Revenue breakdown by category"""
    category: str
    revenue: float
    transactions: int

class InventoryBulkUpdate(BaseModel):
    """Schema for bulk inventory updates"""
    product_id: int
    quantity: int

# Update forward references after all schemas are defined
Inventory.update_forward_refs()
InventoryHistory.update_forward_refs()
InventoryWithHistory.update_forward_refs()
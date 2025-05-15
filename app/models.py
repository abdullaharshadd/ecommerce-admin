from sqlalchemy import Column, Integer, String, Text, Numeric, DateTime, ForeignKey, JSON, Enum
from sqlalchemy.orm import relationship
from .database import Base
from datetime import datetime

class Product(Base):
    __tablename__ = "products"
    product_id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    price = Column(Numeric(10, 2), nullable=False)
    category = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    inventory = relationship("Inventory", back_populates="product", uselist=False)
    sales = relationship("Sale", back_populates="product")
    history = relationship("InventoryHistory", back_populates="product")

class Inventory(Base):
    __tablename__ = "inventory"
    inventory_id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.product_id"), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, default=10)
    last_restocked = Column(DateTime)
    
    # Relationships
    product = relationship("Product", back_populates="inventory")

class Sale(Base):
    __tablename__ = "sales"
    sale_id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.product_id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    total_amount = Column(Numeric(10, 2), nullable=False)
    sale_date = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    product = relationship("Product", back_populates="sales")

class RevenueTracking(Base):
    __tablename__ = "revenue_tracking"
    tracking_id = Column(Integer, primary_key=True, index=True)
    period_type = Column(Enum("daily", "weekly", "monthly", "annual", name="period_types"), nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    total_revenue = Column(Numeric(15, 2), nullable=False)
    category_breakdown = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

class InventoryHistory(Base):
    __tablename__ = "inventory_history"
    history_id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.product_id"), nullable=False)
    previous_quantity = Column(Integer, nullable=False)
    new_quantity = Column(Integer, nullable=False)
    change_reason = Column(String(255), nullable=False)
    changed_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    product = relationship("Product", back_populates="history")
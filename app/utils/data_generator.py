import random
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .. import models
import json

def generate_demo_data(db: Session, num_products=50, num_sales=1000):
    # Categories for our e-commerce store
    categories = [
        "Electronics", "Clothing", "Home & Kitchen", 
        "Books", "Toys", "Sports", "Beauty"
    ]
    
    # Generate products
    products = []
    for i in range(num_products):
        product = models.Product(
            name=f"Product {i+1}",
            description=f"This is a description for product {i+1}",
            price=round(random.uniform(10, 500), 2),
            category=random.choice(categories)
        )
        db.add(product)
        products.append(product)
    db.commit()
    
    # Generate inventory for products
    for product in products:
        inventory = models.Inventory(
            product_id=product.product_id,
            quantity=random.randint(0, 100),
            low_stock_threshold=random.randint(5, 20)
        )
        db.add(inventory)
    db.commit()
    
    # Generate sales data
    for i in range(num_sales):
        product = random.choice(products)
        quantity = random.randint(1, 5)
        sale_date = datetime.now() - timedelta(days=random.randint(0, 365))
        
        sale = models.Sale(
            product_id=product.product_id,
            quantity=quantity,
            unit_price=product.price,
            total_amount=quantity * product.price,
            sale_date=sale_date
        )
        db.add(sale)
    db.commit()
    
    # Generate revenue tracking data (Can be improved)
    for i in range(12):  # 12 months
        month_start = datetime.now() - timedelta(days=30*(i+1))
        month_end = month_start + timedelta(days=30)
        
        revenue = random.uniform(10000, 50000)
        
        tracking = models.RevenueTracking(
            period_type="monthly",
            period_start=month_start.date(),
            period_end=month_end.date(),
            total_revenue=round(revenue, 2),
            category_breakdown=json.dumps({
                cat: round(revenue * random.uniform(0.1, 0.3), 2)
                for cat in categories
            })
        )
        db.add(tracking)
    db.commit()
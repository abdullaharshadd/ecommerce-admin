from fastapi import FastAPI
from app.database import engine, Base, SessionLocal  # Fixed import
from app.endpoints import products, sales, inventory, analytics
from app.utils.data_generator import generate_demo_data  # Fixed import

app = FastAPI(
    title="E-commerce Admin API",
    description="API for managing e-commerce admin dashboard",
    version="1.0.0"
)

# Include routers
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(inventory.router)
app.include_router(analytics.router)

@app.on_event("startup")
async def startup_event():
    # Create database tables
    Base.metadata.create_all(bind=engine)
    
    # Initialize database with demo data
    db = SessionLocal()
    try:
        generate_demo_data(db)
    finally:
        db.close()
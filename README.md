# E-commerce Admin API

![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![MySQL](https://img.shields.io/badge/mysql-%2300f.svg?style=for-the-badge&logo=mysql&logoColor=white)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)

A high-performance backend API for e-commerce management systems built with FastAPI and MySQL.

## Features

- 📊 **Sales Analytics**
  - Filter sales by date range, product, or category
  - Revenue analysis by daily, weekly, monthly, and annual periods
  - Comparison with previous periods

- 📦 **Inventory Management**
  - Real-time stock level monitoring
  - Low stock alerts with configurable thresholds
  - Inventory change history tracking

- 🛍️ **Product Management**
  - Full CRUD operations for products
  - Automatic inventory creation for new products
  - Category-based product organization

- ⚡ **Performance Optimizations**
  - Database indexing on frequently queried columns
  - Efficient query design for analytics
  - Proper database normalization

## Database Schema

### Tables Structure

#### `products`
| Column | Type | Description |
|--------|------|-------------|
| product_id | INT (PK) | Unique product identifier |
| name | VARCHAR(255) | Product name |
| description | TEXT | Product description |
| price | DECIMAL(10,2) | Product price |
| category | VARCHAR(100) | Product category |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

#### `inventory`
| Column | Type | Description |
|--------|------|-------------|
| inventory_id | INT (PK) | Unique inventory record ID |
| product_id | INT (FK) | Reference to products table |
| quantity | INT | Current stock quantity |
| low_stock_threshold | INT | Threshold for low stock alerts |
| last_restocked | TIMESTAMP | When inventory was last updated |

#### `sales`
| Column | Type | Description |
|--------|------|-------------|
| sale_id | INT (PK) | Unique sale identifier |
| product_id | INT (FK) | Reference to products table |
| quantity | INT | Quantity sold |
| unit_price | DECIMAL(10,2) | Price per unit at time of sale |
| total_amount | DECIMAL(10,2) | Total sale amount (quantity × unit_price) |
| sale_date | TIMESTAMP | When sale occurred |

#### `revenue_tracking`
| Column | Type | Description |
|--------|------|-------------|
| tracking_id | INT (PK) | Unique tracking identifier |
| period_type | ENUM | 'daily', 'weekly', 'monthly', 'annual' |
| period_start | DATE | Period start date |
| period_end | DATE | Period end date |
| total_revenue | DECIMAL(15,2) | Total revenue for period |
| category_breakdown | JSON | Revenue by category breakdown |

## API Endpoints

### Products
| Method | Endpoint                 | Description                  |
| ------ | ------------------------ | ---------------------------- |
| `POST` | `/products/`             | Create new product           |
| `GET`  | `/products/`             | List all products            |
| `GET`  | `/products/{product_id}` | Get specific product details |
| `PUT`  | `/products/{product_id}` | Update product information   |

### Sales
| Method | Endpoint                  | Description                                      |
| ------ | ------------------------- | ------------------------------------------------ |
| `POST` | `/sales/`                 | Record new sale                                  |
| `GET`  | `/sales/`                 | List sales (filterable by date/product/category) |
| `GET`  | `/sales/revenue/periodic` | Get revenue by time period                       |

### Inventory
| Method | Endpoint                          | Description                               |
| ------ | --------------------------------- | ----------------------------------------- |
| `GET`  | `/inventory/`                     | View inventory (option: low\_stock\_only) |
| `PUT`  | `/inventory/{product_id}/update`  | Update inventory levels                   |
| `GET`  | `/inventory/history/{product_id}` | View inventory change history             |

### Analytics
| Method | Endpoint                     | Description                                                      |
| ------ | ---------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/analytics/revenue/daily`   | Get daily revenue (defaults to today if no date provided)        |
| `GET`  | `/analytics/revenue/weekly`  | Get weekly revenue (defaults to last 7 days if no date provided) |
| `GET`  | `/analytics/revenue/monthly` | Get monthly revenue for a given year and optionally month        |
| `GET`  | `/analytics/revenue/annual`  | Get annual revenue for a given year                              |
| `GET`  | `/analytics/comparison`      | Compare two date ranges for a given period type                  |

## Setup Instructions

### Prerequisites
- Python 3.7+
- MySQL 5.7+
- pip package manager

### Installation

1. Clone the repository:
```bash
git clone https://github.com/abdullaharshadd/ecommerce-admin.git
cd ecommerce-admin
```

## Create and activate virtual environment
```
python3 -m venv venv
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

## Install dependencies
```
pip install -r requirements.txt
```

## Configure database
* Create a MySQL database
* Create an .env file
* Update connection settings in .env file:
```
DB_USERNAME=yourusername
DB_PASSWORD=yourpassword
DB_HOST=yourhost
DB_NAME=yourdbname
```

## Start the application
```
uvicorn main:app --reload
```

## Usage

### Accessing API Documentation
* Swagger UI (interactive): http://localhost:8000/docs
* ReDoc (alternative viewer): http://localhost:8000/redoc

### Generating Demo Data

To manually generate demo data:

```
from utils.data_generator import generate_demo_data
from database import SessionLocal
db = SessionLocal()
generate_demo_data(db)
db.close()
```

### Example API Calls

```
Create product:
curl -X POST "http://localhost:8000/products/" -H "Content-Type: application/json" -d '{"name":"Smartphone","description":"Latest model","price":599.99,"category":"Electronics"}'

Get sales for date range:
curl -X GET "http://localhost:8000/sales/?start_date=2023-06-01&end_date=2023-06-30"

Get low stock items:
curl -X GET "http://localhost:8000/inventory/?low_stock_only=true"
```

### Project Structure

```
/ecommerce_admin
├── main.py # FastAPI app entry
├── database.py # DB connection
├── models.py # Pydantic models
├── schemas.py # SQLAlchemy models
├── crud.py # DB operations
├── endpoints/ # API routes
│ ├── products.py
│ ├── sales.py
│ ├── inventory.py
│ └── analytics.py
├── utils/ # Utilities
│ ├── data_generator.py
│ └── reports.py
└── requirements.txt # Dependencies
```

### Key Dependencies

* FastAPI
* SQLAlchemy
* mysqlclient
* Uvicorn
* python-dotenv
* Alembic

### Development Setup

#### Install dependencies
```
pip install -r requirements.txt
```

#### Start server
```
uvicorn main:app --reload
```
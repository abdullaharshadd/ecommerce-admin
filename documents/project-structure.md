```
/ecommerce_admin
│
├── main.py                # FastAPI app entry point
├── database.py            # Database connection setup
├── models.py              # Pydantic models
├── schemas.py             # SQLAlchemy models
├── crud.py                # Database operations
├── endpoints/             # API endpoints
│   ├── products.py
│   ├── sales.py
│   ├── inventory.py
│   └── analytics.py
├── utils/                 # Utility functions
│   ├── data_generator.py  # Demo data generation
│   └── reports.py         # Report generation
└── requirements.txt       # Dependencies
```
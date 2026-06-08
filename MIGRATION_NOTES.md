# Migration Notes

**Overall confidence:** 0%  
**Recommendation:** REVIEW RECOMMENDED

---

## What was migrated

- `app/crud.py` → `src/app/crud.ts` (82% confidence) ⚠️ needs review
- `app/database.py` → `src/app/database.ts` (83% confidence) ⚠️ needs review
- `app/endpoints/analytics.py` → `src/app/endpoints/analytics.ts` (89% confidence)
- `app/endpoints/inventory.py` → `src/app/endpoints/inventory.ts` (86% confidence)
- `app/endpoints/products.py` → `src/app/endpoints/products.ts` (88% confidence)
- `app/endpoints/sales.py` → `src/app/endpoints/sales.ts` (80% confidence) ⚠️ needs review
- `app/schemas.py` → `src/app/schemas.ts` (20% confidence) ⚠️ needs review
- `main.py` → `src/main.ts` (80% confidence) ⚠️ needs review
- `app/models.py` → `src/app/models.ts` (88% confidence)
- `app/utils/data_generator.py` → `src/app/utils/data_generator.ts` (75% confidence) ⚠️ needs review
- `app/utils/reports.py` → `src/app/utils/reports.ts` (85% confidence)

## Components that could not be automatically migrated

These components require manual implementation. The migrated code contains
`MIGRATION_NOTE` comments at the relevant locations.

### `create_sale` in `app/crud.py`
**Reason:** Contains a latent bug: get_inventory is called with product_id as the 'skip' argument, so inventory decrement never targets the correct record. A literal automatic translation would preserve the bug.
**Suggestion:** Manually rewrite to fetch the correct Inventory row by product_id (e.g. Inventory.objects.filter(product_id=...).first()) and decrement, ideally inside transaction.atomic().

### `get_revenue_by_period / get_category_revenue` in `app/crud.py`
**Reason:** These return raw SQLAlchemy Row/KeyedTuple results from column-level queries and func aggregations; the shape differs from ORM model instances and depends on relationship config.
**Suggestion:** Rewrite as Django .values().annotate() aggregations and verify the returned dict keys match the expected response schemas (CategoryRevenue); test output shape manually.

### `get_db` in `app/database.py`
**Reason:** This is a FastAPI/SQLAlchemy session dependency generator with no direct Django equivalent; Django handles DB connection lifecycle internally per-request.
**Suggestion:** Remove it. Replace dependency-injected session usage with Django ORM model managers (e.g. MyModel.objects). No manual session open/close is needed in Django.

### `SessionLocal` in `app/database.py`
**Reason:** SQLAlchemy session factory has no Django counterpart since Django does not expose user-managed sessions for ordinary ORM use.
**Suggestion:** Remove it. Use Django's transaction.atomic() for transaction control where the autocommit=False behavior was relied upon.

### `Base` in `app/database.py`
**Reason:** SQLAlchemy declarative base cannot be auto-converted; ORM model field definitions differ fundamentally between SQLAlchemy and Django.
**Suggestion:** Manual rewrite: convert each SQLAlchemy model deriving from Base into a django.db.models.Model subclass, then generate migrations via makemigrations.

### `engine` in `app/database.py`
**Reason:** Django creates and manages the DB engine internally from the DATABASES setting; an explicit create_engine is not used.
**Suggestion:** Remove it. Define the connection in settings.py DATABASES instead.

### `generate_revenue_report / calculate_percentage_change` in `app/endpoints/analytics.py`
**Reason:** These functions are imported from app/utils/reports.py and contain the actual SQLAlchemy query and aggregation business logic, which is not present in this file. Their overloaded call signatures cannot be fully resolved without that source.
**Suggestion:** Migrate app/utils/reports.py separately; rewrite the SQLAlchemy queries to Django ORM (or keep equivalent service-layer functions). Normalize the overloaded signature into clearly typed methods during the rewrite.

### `startup_event` in `main.py`
**Reason:** Running table creation and data seeding inside an app startup event is FastAPI/SQLAlchemy-specific and conflicts with Django's migration-based schema management.
**Suggestion:** Replace Base.metadata.create_all with Django migrations (manage.py migrate) and move generate_demo_data into a custom management command or a data migration rather than a startup hook.

### `app = FastAPI(...)` in `main.py`
**Reason:** The FastAPI app object and its router inclusion model have no 1:1 Django equivalent; routing is handled via URLconf/DRF routers instead.
**Suggestion:** Manual rewrite: create Django project settings and root urls.py, and register each endpoint module via DRF routers or path() includes.

## Observer agent findings

The Observer agent monitored the migration and identified these patterns:

- **After 3 modules:** Could not parse observer output
- **After 6 modules:** Could not parse observer output
- **After 9 modules:** Could not parse observer output

## Files requiring manual review

These files were migrated but scored below the confidence threshold.
Review them carefully before merging.

### `app/crud.py`
Confidence: 82%
Issues:
  - [warning] The migration intentionally 'fixes' the latent bug in the original where get_inventory(db, sale.product_id) returned a list (product_id passed as skip), making inventory decrement effectively a no-op. The migrated version correctly decrements the matching product's inventory. This is a behavioral DIVERGENCE from the original observable behavior, though it implements the clearly-intended logic.

### `app/database.py`
Confidence: 83%
Issues:
  - [info] The migration always inserts an explicit port (defaulting to 3306) into the URL, whereas the original omitted the port entirely. This is a benign, expected difference since Prisma/MySQL defaults to 3306 anyway, and URL-encoding credentials is a reasonable improvement.
  - [info] The original Python interpolated missing env vars as the literal string 'None' into the URL (no validation). The migration delegates to a config module that is described as validating presence, which would instead fail fast. This is an acceptable and arguably better behavior in a migration, not a logic break.

### `app/endpoints/sales.py`
Confidence: 80%
Issues:
  - [warning] The saleCreateSchema is an empty passthrough object, so no actual field validation occurs. The original returns 422 on SaleCreate validation failure; here any body (including empty) passes validation. This is acknowledged in a MIGRATION_NOTE as needing the concrete schemas.py fields.

### `app/schemas.py`
Confidence: 20%

### `main.py`
Confidence: 80%
Issues:
  - [info] Demo data seeding is now guarded behind a SEED_DEMO_DATA env flag, whereas the original always invoked generate_demo_data unconditionally on startup.
  - [info] Table creation (Base.metadata.create_all) is intentionally omitted in favor of Prisma migrations applied at deploy time.

### `app/utils/data_generator.py`
Confidence: 75%
Issues:
  - [warning] The inventory generation uses `tx.product.findMany()` to re-fetch products after createMany. If the database already contains products from a prior run (the function 'only writes data; it does not read or delete'), inventory records would be created for ALL products including pre-existing ones, not just the num_products newly created. This breaks the invariant 'Exactly one Inventory record is created per generated Product'. In a fresh demo DB this is fine, but on a non-empty DB it diverges.
  - [info] total_amount: original computes `quantity * product.price` where product.price was already round2'd at creation. Migration recomputes via `round2(quantity * Number(product.price))`, applying an extra round2 to the product. Since product.price is already 2-decimal, quantity*price stays 2-decimal, so round2 is a no-op here — acceptable. Also original did NOT round total_amount; the added round2 is harmless given integer quantity and 2-decimal price.
  - [warning] category_breakdown is passed as an object assuming a Json column, whereas the original used json.dumps(...) for a String column. If schema.prisma declares it as String, this would fail at runtime. The migration explicitly flags this as REVIEW required.

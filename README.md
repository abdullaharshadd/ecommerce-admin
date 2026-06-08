# ecommerce-admin

A Node.js/Express REST API for e-commerce administration, providing inventory management, sales tracking, and revenue analytics. Migrated from a Python/FastAPI + SQLAlchemy codebase.

> ⚠️ **Migration confidence: 0% — This codebase requires significant manual review before it is production-ready.** Multiple core components could not be automatically migrated. Read the [Known Limitations](#known-limitations) and [Manual Review Required](#manual-review-required) sections before running anything.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Package manager | npm |

---

## Prerequisites

- Node.js (v18 or later recommended)
- npm (v9 or later)
- A running database instance (see [Known Limitations](#known-limitations) — database configuration was not fully migrated)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/abdullaharshadd/ecommerce-admin.git
cd ecommerce-admin
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment setup

No environment variables were detected during migration analysis. However, you will need to manually configure database connection settings before the application can run. Create a `.env` file in the project root and add any required values (see [Environment Variables](#environment-variables)).

### 4. Database setup

> ⚠️ **The database setup was not migrated.** The original codebase used SQLAlchemy with a FastAPI startup event to create tables and seed demo data. No equivalent setup has been automatically generated.

You must manually:

1. Define your database connection in the application configuration.
2. Create the schema (write and run migrations, or execute DDL manually).
3. Port the demo data seeder from `app/utils/data_generator.py` if needed.

### 5. Run the application

> ⚠️ **No start command was detected during migration.** Check `package.json` for available scripts. A typical Express start command would be:

```bash
node index.js
# or, if a start script is defined:
npm start
```

---

## Running Tests

> ⚠️ **No test command was detected during migration.** If tests exist, check `package.json` for a test script:

```bash
npm test
```

No test suite was carried over from the original codebase. You should write tests before relying on any migrated endpoint behavior.

---

## Environment Variables

No environment variables were identified during automated migration analysis. Based on the original codebase's functionality, you will likely need to configure the following manually:

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` or equivalent | Connection string for your database | Yes |
| `PORT` | Port the Express server listens on | No (default typically 3000) |

Populate a `.env` file at the project root and load it in your application entry point (e.g., using the `dotenv` package).

---

## Architecture Overview

The migrated project follows the module structure of the original FastAPI application, reorganized for Express:

```
ecommerce-admin/
├── app/
│   ├── crud.js              # Data access layer (migrated from crud.py — contains known bugs, see below)
│   ├── database.js          # DB connection setup (partially migrated — manual rewrite required)
│   ├── schemas.js           # Request/response shape definitions (migrated from schemas.py)
│   ├── endpoints/
│   │   ├── sales.js         # Sales endpoints (low confidence migration)
│   │   └── analytics.js     # Analytics/reporting endpoints (depends on unmigrated utils)
│   └── utils/
│       └── data_generator.js # Demo data seeder (low confidence migration)
├── main.js                  # Application entry point (migrated from main.py — partial)
├── package.json
└── .env                     # Not committed — create manually
```

The original FastAPI dependency injection pattern (`get_db` yielding a SQLAlchemy session) has been removed. Database access should be handled through your chosen Node.js ORM or query library directly in each module.

---

## Migration Notes

This project was migrated from **Python / FastAPI + SQLAlchemy** to **Node.js / Express**.

### What changed

| Area | Original (FastAPI/SQLAlchemy) | Migrated (Express) |
|---|---|---|
| Framework | FastAPI | Express |
| ORM / DB layer | SQLAlchemy (declarative Base, SessionLocal) | Not replaced — must be chosen and wired manually |
| Request validation | Pydantic schemas (`app/schemas.py`) | Translated to `app/schemas.js` — verify shape accuracy |
| Dependency injection | `Depends(get_db)` per-request session | Removed — no direct equivalent in Express |
| App entry point | `main.py` with `@app.on_event("startup")` | `main.js` — startup hook logic not ported |
| Routing | FastAPI `APIRouter` includes | Express `Router` — verify all routes are registered |
| Migrations / schema | `Base.metadata.create_all` at startup | No migration tooling set up — must be added manually |
| Demo data seeding | Called inside startup event | Not wired — `data_generator.js` exists but is not invoked |
| Analytics aggregations | SQLAlchemy `func` aggregations, raw Row results | Not fully translated — see Known Limitations |

---

## Known Limitations

The following components **could not be automatically migrated** and contain bugs, structural incompatibilities, or missing logic. Do not use these in production without a manual rewrite.

---

### `app/crud.js` — `create_sale`

**Reason:** The original Python code contains a latent bug: `get_inventory` is called with `product_id` passed as the `skip` (offset) argument, meaning inventory decrement never targets the correct record. The automated migration preserved this bug rather than guessing intent.

**Action required:** Manually rewrite this function. Fetch the correct inventory row by `product_id` (e.g., `WHERE product_id = ?`), decrement the quantity, and wrap the operation in a database transaction.

---

### `app/crud.js` — `get_revenue_by_period` / `get_category_revenue`

**Reason:** These functions return raw SQLAlchemy `Row`/`KeyedTuple` results from column-level queries and `func` aggregations. The shape of these results differs from ORM model instances and depends on relationship configuration that was not carried over.

**Action required:** Rewrite as proper aggregation queries in your chosen Node.js DB library. Verify that the returned object keys match the `CategoryRevenue` response schema. Test the output shape manually against the API response contract.

---

### `app/database.js` — `get_db`, `SessionLocal`, `Base`, `engine`

**Reason:** These are SQLAlchemy/FastAPI-specific constructs with no automatic Node.js equivalent:
- `get_db`: FastAPI dependency generator — Express has no equivalent pattern.
- `SessionLocal`: SQLAlchemy session factory — not applicable outside SQLAlchemy.
- `Base`: SQLAlchemy declarative base — ORM model definitions are fundamentally different in any Node.js ORM.
- `engine`: SQLAlchemy creates a managed engine; Express apps configure DB connections differently.

**Action required:**
- Choose a Node.js database library (e.g., Prisma, Sequelize, Knex, `pg`).
- Remove or replace all constructs in `database.js`.
- Define your connection configuration directly in that library's setup.
- Rewrite all model definitions from scratch based on the original SQLAlchemy models.
- Use the library's transaction API wherever `autocommit=False` behavior was relied upon.

---

### `app/endpoints/sales.js` — Full file

**Reason:** Low confidence migration. The original `sales.py` depends on `crud` functions that contain known bugs (see `create_sale` above). The migrated file may structurally resemble the original but correctness cannot be guaranteed.

**Action required:** After rewriting `crud.js`, audit every route in `sales.js` and verify request handling, error responses, and data shapes.

---

### `app/endpoints/analytics.js` — `generate_revenue_report` / `calculate_percentage_change`

**Reason:** These functions delegate to `app/utils/reports.py`, which contains the actual SQLAlchemy query logic. That file was not present in the migration input, so the business logic could not be translated. The overloaded call signatures also could not be fully resolved.

**Action required:** Locate `app/utils/reports.py` in the original repository. Rewrite its SQLAlchemy queries as equivalent queries in your chosen Node.js DB library. Consolidate any overloaded function signatures into clearly typed functions.

---

### `main.js` — `startup_event` / App initialization

**Reason:** The FastAPI `@app.on_event("startup")` hook called `Base.metadata.create_all` (schema creation) and `generate_demo_data` (seeding). Neither of these has a direct Express equivalent and both conflict with a proper migration-based workflow.

**Action required:**
- Do not call schema creation code at application startup.
- Set up a migration tool (e.g., Prisma Migrate, Sequelize CLI, Flyway) and run migrations explicitly before starting the server.
- Move demo data generation into a standalone script (e.g., `npm run seed`) invoked manually.
- Rewrite the Express app initialization in `main.js` to explicitly register all routers via `app.use()`.

---

### `app/utils/data_generator.js`

**Reason:** Low confidence migration from `data_generator.py`. The seeding logic depends on database models that were not fully migrated.

**Action required:** Rewrite after database models are finalized. Verify all generated data conforms to the schema constraints of your chosen ORM.

---

### `app/schemas.js`

**Reason:** Low confidence migration. Pydantic schemas (including validators, field aliases, and default factories) do not map directly to plain JavaScript objects or common Node.js validation libraries.

**Action required:** Audit every schema definition. If runtime validation is needed, integrate a library such as `zod` or `joi` and rewrite schemas accordingly. Pay close attention to any field that had a Pydantic validator or computed default.

---

## Manual Review Required

The following files must be reviewed and likely rewritten by a developer before the application is functional. Do not treat the migrated output as correct.

| File | Component(s) | Priority |
|---|---|---|
| `app/database.js` | Entire file | 🔴 Critical — nothing in this file is usable as-is |
| `app/crud.js` | `create_sale` | 🔴 Critical — contains a known bug from the original source |
| `app/crud.js` | `get_revenue_by_period`, `get_category_revenue` | 🔴 Critical — return shape is incorrect |
| `main.js` | App initialization, startup hook | 🔴 Critical — routing and startup logic incomplete |
| `app/endpoints/analytics.js` | `generate_revenue_report`, `calculate_percentage_change` | 🔴 Critical — business logic not migrated |
| `app/endpoints/sales.js` | All routes | 🟠 High — depends on buggy crud layer |
| `app/schemas.js` | All schema definitions | 🟠 High — validation behavior not guaranteed |
| `app/utils/data_generator.js` | All functions | 🟡 Medium — needed for seeding only, but untested |

---

## Original Repository

Source project: [abdullaharshadd/ecommerce-admin](https://github.com/abdullaharshadd/ecommerce-admin)

Original stack: Python · FastAPI · SQLAlchemy · Pydantic
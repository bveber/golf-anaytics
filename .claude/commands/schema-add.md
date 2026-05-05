---
description: Safely add a column or table to the DuckDB schema. Usage: /schema-add <description of what to add and why>
---

Add a new column or table to the golf-analytics DuckDB schema.

What to add: $ARGUMENTS

Use the sql-duckdb-agent to implement this. The agent must:

1. Read `db/schema.sql` to understand existing tables, types, and relationships.
2. Design the schema change:
   - New columns: choose the right DuckDB type (DOUBLE for metrics, TEXT for labels, TIMESTAMPTZ for times, BOOLEAN for flags)
   - New tables: include a PRIMARY KEY, foreign key to sessions if shot-level, and a scraped_at/created_at column
   - Default values that make the migration idempotent
3. Update `db/schema.sql` with the new CREATE TABLE or ALTER TABLE statement. Use `IF NOT EXISTS` / `IF NOT EXISTS column` patterns so the file can be re-run safely.
4. Write the actual migration against the live DB: `.venv/bin/python -c "import duckdb; conn = duckdb.connect('db/golf_analytics.duckdb'); conn.execute('ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...')"`
5. Verify the column/table exists in the live DB after the migration.
6. If the new column should be populated from existing data, write and run the backfill query.
7. Report: exact DDL added to schema.sql, migration applied, and row count affected by any backfill.

Never drop columns or tables. Never change existing column types.
